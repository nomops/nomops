import type { INodeExecutionData, INodeType, IPollContext } from '@nomops/workflow';
import { OperationalError } from '@nomops/workflow';
import { parseEmail } from '../../lib/email-parser.js';
import { connectImapClient } from '../../lib/imap-client.js';
import { emailTriggerDescription } from './EmailTrigger.description.js';

export class EmailTrigger implements INodeType {
  description = emailTriggerDescription;

  async poll(this: IPollContext): Promise<INodeExecutionData[][] | null> {
    const credentials = await this.getCredentials('imap');
    const mailbox = String(this.getNodeParameter('mailbox') ?? 'INBOX');
    const markAsRead = String(this.getNodeParameter('postProcessAction') ?? 'read') === 'read';
    const format = String(this.getNodeParameter('format') ?? 'simple');
    const timeout = Math.max(1_000, Math.min(300_000, Number(this.getNodeParameter('timeout') ?? 15_000)));
    const staticData = this.getWorkflowStaticData('node');
    const lastUid = Math.max(0, Number(staticData['lastUid'] ?? 0));
    let client;
    try {
      client = await connectImapClient(credentials, timeout);
      const messages = await client.fetchSince(mailbox, lastUid, markAsRead);
      if (messages.length === 0) return null;
      const freshKeys = new Set(await this.helpers.filterNewKeys(messages.map((message) => String(message.uid))));
      const fresh = messages.filter((message) => freshKeys.has(String(message.uid)));
      staticData['lastUid'] = Math.max(lastUid, ...messages.map((message) => message.uid));
      if (fresh.length === 0) return null;
      return [fresh.map((message) => ({ json: parseEmail(message.raw, message.uid, format) }))];
    } catch (error) {
      if (error instanceof OperationalError) throw error;
      throw new OperationalError('IMAP polling failed', {});
    } finally {
      await client?.close().catch(() => undefined);
    }
  }
}
