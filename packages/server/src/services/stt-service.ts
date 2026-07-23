import type { Repositories } from '@nomops/db';
import { OperationalError } from '@nomops/workflow';

/**
 * 语音转写（STT，backlog #32）。
 *
 * 零依赖：直接 POST multipart 到 OpenAI/Whisper 兼容的 /v1/audio/transcriptions
 * （同 OTLP/Vault/SMTP 的取舍——不引 SDK）。fetchImpl 可注入测试。
 * 配置存 settings；apiKey 绝不经 API 回显（铁律 3），未配 → 转写请求 400。
 */
export interface ISttConfig {
  enabled: boolean;
  endpoint: string;
  model: string;
  apiKey: string;
}

/** 对外暴露的配置视图：不含 apiKey 明文，只报是否已配。 */
export interface ISttPublicConfig {
  enabled: boolean;
  endpoint: string;
  model: string;
  apiKeyConfigured: boolean;
}

const SETTINGS_KEY = 'stt.config';
const DEFAULTS: ISttConfig = {
  enabled: false,
  endpoint: 'https://api.openai.com/v1/audio/transcriptions',
  model: 'whisper-1',
  apiKey: '',
};

export class SttService {
  constructor(
    private readonly repos: Repositories,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /** 内部用（含 apiKey）。 */
  private async getConfig(): Promise<ISttConfig> {
    const raw = await this.repos.settings.get(SETTINGS_KEY);
    if (!raw) return { ...DEFAULTS };
    try {
      return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<ISttConfig>) };
    } catch {
      return { ...DEFAULTS };
    }
  }

  /** API 视图：屏蔽 apiKey，只报是否已配。 */
  async getPublicConfig(): Promise<ISttPublicConfig> {
    const c = await this.getConfig();
    return { enabled: c.enabled, endpoint: c.endpoint, model: c.model, apiKeyConfigured: c.apiKey.length > 0 };
  }

  /** apiKey 省略（undefined）= 保留旧值；空串同样保留（避免清空误操作，与 SSO clientSecret 同约定）。 */
  async setConfig(input: Partial<ISttConfig>): Promise<ISttPublicConfig> {
    const current = await this.getConfig();
    const next: ISttConfig = {
      enabled: typeof input.enabled === 'boolean' ? input.enabled : current.enabled,
      endpoint: typeof input.endpoint === 'string' ? input.endpoint.trim() || DEFAULTS.endpoint : current.endpoint,
      model: typeof input.model === 'string' ? input.model.trim() || DEFAULTS.model : current.model,
      apiKey: typeof input.apiKey === 'string' && input.apiKey.length > 0 ? input.apiKey : current.apiKey,
    };
    await this.repos.settings.set(SETTINGS_KEY, JSON.stringify(next));
    return this.getPublicConfig();
  }

  /** 转写一段音频（base64）→ 文本。未启用/未配 apiKey → 400。 */
  async transcribe(audioBase64: string, mimeType: string, fileName?: string): Promise<{ text: string }> {
    const cfg = await this.getConfig();
    if (!cfg.enabled) throw new OperationalError('Speech-to-text is not enabled on this instance', { status: 400 });
    if (!cfg.apiKey) throw new OperationalError('Speech-to-text has no API key configured', { status: 400 });

    const form = new FormData();
    form.append('model', cfg.model);
    form.append('file', new Blob([Buffer.from(audioBase64, 'base64')], { type: mimeType }), fileName ?? 'audio.webm');

    const res = await this.fetchImpl(cfg.endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.apiKey}` },
      body: form,
    });
    if (!res.ok) {
      throw new OperationalError(`Transcription failed: HTTP ${res.status}`, { status: 502 });
    }
    const data = (await res.json()) as { text?: string };
    return { text: String(data.text ?? '') };
  }
}
