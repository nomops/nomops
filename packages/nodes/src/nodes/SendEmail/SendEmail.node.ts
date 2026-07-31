import type { IExecuteContext, INodeExecutionData, INodeType } from '@nomops/workflow';
import { OperationalError } from '@nomops/workflow';
import { sendSmtpMail } from '../../lib/smtp-client.js';
import { sendEmailDescription } from './SendEmail.description.js';

export class SendEmail implements INodeType {
  description = sendEmailDescription;

  async execute(this: IExecuteContext): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const credentials = await this.getCredentials('smtp');
    const output: INodeExecutionData[] = [];
    for (const [itemIndex, item] of items.entries()) {
      try {
        const contentType = String(this.getNodeParameter('contentType', itemIndex, 'text'));
        const result = await sendSmtpMail(
          {
            host: String(credentials['host'] ?? ''),
            port: Number(credentials['port'] ?? 465),
            secure: credentials['secure'] !== false,
            user: String(credentials['user'] ?? ''),
            password: String(credentials['password'] ?? ''),
            disableStartTls: credentials['disableStartTls'] === true,
            clientHostname: String(credentials['hostName'] ?? ''),
            rejectUnauthorized: credentials['allowUnauthorizedCerts'] !== true,
          },
          {
            from: String(this.getNodeParameter('fromEmail', itemIndex, '')),
            to: String(this.getNodeParameter('toEmail', itemIndex, '')),
            cc: String(this.getNodeParameter('ccEmail', itemIndex, '')),
            bcc: String(this.getNodeParameter('bccEmail', itemIndex, '')),
            replyTo: String(this.getNodeParameter('replyTo', itemIndex, '')),
            subject: String(this.getNodeParameter('subject', itemIndex, '')),
            text: String(this.getNodeParameter('text', itemIndex, '')),
            ...(contentType === 'html' ? { html: String(this.getNodeParameter('html', itemIndex, '')) } : {}),
          },
        );
        output.push({ json: { ...item.json, ...result }, pairedItem: { item: itemIndex } });
      } catch (error) {
        if (error instanceof OperationalError) throw error;
        throw new OperationalError('SMTP delivery failed', {});
      }
    }
    return [output];
  }
}
