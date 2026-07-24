import { randomBytes } from 'node:crypto';
import type { AgentChannel, Repositories } from '@nomops/db';
import type { JsonObject } from '@nomops/workflow';
import { OperationalError } from '@nomops/workflow';
import type { AgentRunService } from './agent-run-service.js';
import type { CredentialService } from './credential-service.js';

/**
 * Agent 外部渠道（backlog #44 M5）：Telegram bot webhook → agent 线程 → 回复回渠道。
 * bot token(telegramApi 凭证 accessToken 字段)存凭证系统,解密即用即弃（铁律 3,不落库/不出 API/不进日志）;
 * webhook 公开路径带随机 secret,不匹配一律 404。telegramFetch 可注入(测试不打真实网络)。
 */

/** Telegram update 里我们关心的最小子集。 */
interface ITelegramUpdate {
  message?: {
    chat?: { id?: number | string };
    text?: string;
  };
}

export interface IChannelView {
  id: string;
  agentId: string;
  type: string;
  credentialId: string;
  active: boolean;
  createdAt: Date;
  webhookUrl: string; // 带 secret 的公开入口（只回给归属方 API,不进日志）
}

export class AgentChannelService {
  constructor(
    private readonly repos: Repositories,
    private readonly agentRuns: AgentRunService,
    private readonly credentials: CredentialService,
    private readonly baseUrl: string,
    private readonly telegramFetch: typeof fetch = fetch,
  ) {}

  private webhookUrl(channel: AgentChannel): string {
    const secret = String((channel.config as JsonObject)['webhookSecret'] ?? '');
    return `${this.baseUrl}/webhook/agent-channel/${channel.id}/${secret}`;
  }

  private view(channel: AgentChannel): IChannelView {
    return {
      id: channel.id,
      agentId: channel.agentId,
      type: channel.type,
      credentialId: channel.credentialId,
      active: channel.active,
      createdAt: channel.createdAt,
      webhookUrl: this.webhookUrl(channel),
    };
  }

  async list(agentId: string): Promise<IChannelView[]> {
    return (await this.repos.agents.listChannels(agentId)).map((c) => this.view(c));
  }

  /** 建渠道：校验 agent + 凭证归属,生成 webhookSecret,尽力注册 Telegram webhook(失败不阻塞)。 */
  async create(agentId: string, projectId: string, input: { type: string; credentialId: string }): Promise<IChannelView> {
    if (input.type !== 'telegram') throw new OperationalError(`Unsupported channel type: ${input.type}`, { status: 400 });
    const agent = await this.repos.agents.findById(agentId, projectId);
    if (!agent) throw new OperationalError('Agent not found', { status: 404 });
    await this.credentials.assertOwnerProject(input.credentialId, projectId); // 凭证归属（铁律 2）

    const webhookSecret = randomBytes(16).toString('hex');
    const channel = await this.repos.agents.createChannel({
      agentId,
      projectId,
      type: input.type,
      credentialId: input.credentialId,
      config: { webhookSecret },
    });

    // 尽力向 Telegram 注册 webhook。自托管 baseUrl 可能公网不可达（docs/12 风险）——
    // 失败只影响自动注册,用户仍可拿 webhookUrl 手动 setWebhook,故不阻塞建渠道。
    await this.trySetTelegramWebhook(channel, projectId);
    return this.view(channel);
  }

  private async trySetTelegramWebhook(channel: AgentChannel, projectId: string): Promise<void> {
    try {
      const botToken = String((await this.credentials.rawData(channel.credentialId, projectId))['accessToken'] ?? '');
      if (!botToken) return;
      await this.telegramFetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: this.webhookUrl(channel) }),
      });
    } catch {
      // 注册失败不阻塞;token 不落日志（铁律 3）
      console.warn(`[nomops] Telegram webhook 自动注册失败（channel ${channel.id}）,可手动 setWebhook`);
    }
  }

  async setActive(agentId: string, channelId: string, active: boolean): Promise<IChannelView> {
    const channel = await this.repos.agents.findChannel(channelId, agentId);
    if (!channel) throw new OperationalError('Channel not found', { status: 404 });
    await this.repos.agents.updateChannel(channelId, { active });
    return this.view({ ...channel, active });
  }

  async remove(agentId: string, channelId: string): Promise<void> {
    const channel = await this.repos.agents.findChannel(channelId, agentId);
    if (!channel) throw new OperationalError('Channel not found', { status: 404 });
    await this.repos.agents.deleteChannel(channelId);
  }

  /**
   * 公开 webhook 入口：Telegram update → agent 运行 → 回复回渠道。
   * 同一 chat_id 复用同一线程(externalRef 映射),对话上下文连续。
   */
  async handleTelegramUpdate(channelId: string, secret: string, update: ITelegramUpdate): Promise<{ ok: boolean; runId?: string }> {
    const channel = await this.repos.agents.findChannelById(channelId);
    const expected = channel ? String((channel.config as JsonObject)['webhookSecret'] ?? '') : '';
    // 渠道不存在/停用/secret 不匹配一律 404,不泄露渠道是否存在
    if (!channel || !channel.active || !expected || secret !== expected) {
      throw new OperationalError('Not found', { status: 404 });
    }
    const chatId = update.message?.chat?.id;
    const text = update.message?.text?.trim();
    if (chatId === undefined || chatId === null || !text) return { ok: true }; // 非文本消息：确认收到,不触发

    const ref = String(chatId);
    const thread =
      (await this.repos.agents.findThreadByExternalRef(channel.agentId, 'telegram', ref)) ??
      (await this.repos.agents.createThread({
        agentId: channel.agentId,
        projectId: channel.projectId,
        channel: 'telegram',
        externalRef: ref,
        title: `Telegram ${ref}`,
      }));

    const res = await this.agentRuns.chat(channel.agentId, channel.projectId, text, thread.id, 'telegram');

    // 回复回渠道：解密 bot token 即用即弃（铁律 3）
    try {
      const botToken = String((await this.credentials.rawData(channel.credentialId, channel.projectId))['accessToken'] ?? '');
      if (botToken) {
        const sent = await this.telegramFetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text: res.error ?? res.reply }),
        });
        // HTTP 非 2xx（如 token 无效 401）fetch 不抛,显式记警告——不落 token（铁律 3）
        if (!sent.ok) console.warn(`[nomops] Telegram 回复被拒（HTTP ${sent.status}, channel ${channel.id}, run ${res.runId}）`);
      }
    } catch {
      console.warn(`[nomops] Telegram 回复发送失败（channel ${channel.id}, run ${res.runId}）`);
    }
    return { ok: true, runId: res.runId };
  }
}
