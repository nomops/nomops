/**
 * 凭证类型元数据（前端渲染字段用；不含任何密文/明文）。
 * nomops 自有类型集合，与节点 description.credentials 引用的 name 对应。
 */
export interface CredentialField {
  name: string; // 存进 credential data 的 key
  label: string;
  type: 'text' | 'password';
  placeholder?: string;
}

export interface CredentialTypeMeta {
  type: string; // 与节点 credentials.name 对应
  displayName: string;
  icon: string;
  description: string;
  fields: CredentialField[];
  /** OAuth2 类型：配置界面显示「Connect my account」授权流程。 */
  oauth?: boolean;
  /** 创建时固定写入 data 的值（如 demo provider 标记，无需用户填）。 */
  presetData?: Record<string, string>;
}

export const CREDENTIAL_TYPES: CredentialTypeMeta[] = [
  {
    type: 'httpHeaderAuth',
    displayName: 'HTTP Header Auth',
    icon: '🔑',
    description: 'Authenticate with a custom request header (e.g. X-API-Key)',
    fields: [
      { name: 'name', label: 'Header name', type: 'text', placeholder: 'X-API-Key' },
      { name: 'value', label: 'Header value', type: 'password' },
    ],
  },
  {
    type: 'httpBasicAuth',
    displayName: 'HTTP Basic Auth',
    icon: '👤',
    description: 'Basic auth with a username and password',
    fields: [
      { name: 'user', label: 'Username', type: 'text' },
      { name: 'password', label: 'Password', type: 'password' },
    ],
  },
  {
    type: 'anthropicApi',
    displayName: 'Anthropic API',
    icon: '✦',
    description: 'Claude API key (used by the AI Agent node)',
    fields: [{ name: 'apiKey', label: 'API Key', type: 'password', placeholder: 'sk-ant-…' }],
  },
  {
    type: 'oauth2Api',
    displayName: 'OAuth2 API',
    icon: '🔗',
    description: 'Generic OAuth2 (authorization code) — connect any provider by its authorization & token URLs',
    oauth: true,
    fields: [
      { name: 'clientId', label: 'Client ID', type: 'text' },
      { name: 'clientSecret', label: 'Client Secret', type: 'password' },
      { name: 'authUrl', label: 'Authorization URL', type: 'text', placeholder: 'https://provider.com/oauth/authorize' },
      { name: 'accessTokenUrl', label: 'Access Token URL', type: 'text', placeholder: 'https://provider.com/oauth/token' },
      { name: 'scope', label: 'Scope', type: 'text', placeholder: 'read write' },
    ],
  },
  {
    type: 'demoOAuth2',
    displayName: 'Demo OAuth2',
    icon: '🔓',
    description: 'Try the “Connect my account” flow against the built-in demo provider — no app registration needed',
    oauth: true,
    presetData: { provider: 'demo', clientId: 'demo' },
    fields: [],
  },

  // ── Generic auth schemes ──────────────────────────────────────────────
  {
    type: 'httpDigestAuth',
    displayName: 'HTTP Digest Auth',
    icon: '🔐',
    description: 'Digest access authentication with a username and password',
    fields: [
      { name: 'user', label: 'Username', type: 'text' },
      { name: 'password', label: 'Password', type: 'password' },
    ],
  },
  {
    type: 'httpQueryAuth',
    displayName: 'HTTP Query Auth',
    icon: '🔎',
    description: 'Authenticate by appending a key/value pair to the query string',
    fields: [
      { name: 'name', label: 'Parameter name', type: 'text', placeholder: 'api_key' },
      { name: 'value', label: 'Parameter value', type: 'password' },
    ],
  },
  {
    type: 'oauth1Api',
    displayName: 'OAuth1 API',
    icon: '🔗',
    description: 'Generic OAuth1 — connect a provider with consumer key/secret and token URLs',
    fields: [
      { name: 'consumerKey', label: 'Consumer Key', type: 'text' },
      { name: 'consumerSecret', label: 'Consumer Secret', type: 'password' },
      { name: 'requestTokenUrl', label: 'Request Token URL', type: 'text', placeholder: 'https://provider.com/oauth/request_token' },
      { name: 'authUrl', label: 'Authorization URL', type: 'text', placeholder: 'https://provider.com/oauth/authorize' },
      { name: 'accessTokenUrl', label: 'Access Token URL', type: 'text', placeholder: 'https://provider.com/oauth/access_token' },
    ],
  },

  // ── Applications (A–Z) ────────────────────────────────────────────────
  {
    type: 'activeCampaignApi',
    displayName: 'ActiveCampaign API',
    icon: '📧',
    description: 'Connect to ActiveCampaign marketing automation',
    fields: [
      { name: 'apiUrl', label: 'API URL', type: 'text', placeholder: 'https://your-account.api-us1.com' },
      { name: 'apiKey', label: 'API Key', type: 'password' },
    ],
  },
  {
    type: 'acuitySchedulingApi',
    displayName: 'Acuity Scheduling API',
    icon: '📅',
    description: 'Connect to Acuity Scheduling appointment booking',
    fields: [
      { name: 'userId', label: 'User ID', type: 'text' },
      { name: 'apiKey', label: 'API Key', type: 'password' },
    ],
  },
  {
    type: 'airtableApi',
    displayName: 'Airtable API',
    icon: '🗂️',
    description: 'Connect to Airtable with a personal access token',
    fields: [{ name: 'apiKey', label: 'Personal Access Token', type: 'password' }],
  },
  {
    type: 'airtableOAuth2Api',
    displayName: 'Airtable OAuth2 API',
    icon: '🗂️',
    description: 'Connect to Airtable via OAuth2',
    oauth: true,
    presetData: { authUrl: 'https://airtable.com/oauth2/v1/authorize', accessTokenUrl: 'https://airtable.com/oauth2/v1/token' },
    fields: [
      { name: 'clientId', label: 'Client ID', type: 'text' },
      { name: 'clientSecret', label: 'Client Secret', type: 'password' },
    ],
  },
  {
    type: 'asanaApi',
    displayName: 'Asana API',
    icon: '🎯',
    description: 'Connect to Asana with a personal access token',
    fields: [{ name: 'accessToken', label: 'Personal Access Token', type: 'password' }],
  },
  {
    type: 'asanaOAuth2Api',
    displayName: 'Asana OAuth2 API',
    icon: '🎯',
    description: 'Connect to Asana via OAuth2',
    oauth: true,
    presetData: { authUrl: 'https://app.asana.com/-/oauth_authorize', accessTokenUrl: 'https://app.asana.com/-/oauth_token' },
    fields: [
      { name: 'clientId', label: 'Client ID', type: 'text' },
      { name: 'clientSecret', label: 'Client Secret', type: 'password' },
    ],
  },
  {
    type: 'aws',
    displayName: 'AWS',
    icon: '☁️',
    description: 'Amazon Web Services access key credentials',
    fields: [
      { name: 'region', label: 'Region', type: 'text', placeholder: 'us-east-1' },
      { name: 'accessKeyId', label: 'Access Key ID', type: 'text' },
      { name: 'secretAccessKey', label: 'Secret Access Key', type: 'password' },
    ],
  },
  {
    type: 'clickUpApi',
    displayName: 'ClickUp API',
    icon: '✅',
    description: 'Connect to ClickUp with an API token',
    fields: [{ name: 'apiKey', label: 'API Token', type: 'password' }],
  },
  {
    type: 'discordApi',
    displayName: 'Discord API',
    icon: '🎮',
    description: 'Connect to Discord with a bot token',
    fields: [{ name: 'botToken', label: 'Bot Token', type: 'password' }],
  },
  {
    type: 'discordWebhook',
    displayName: 'Discord Webhook',
    icon: '🪝',
    description: 'Post messages to a Discord channel via an incoming webhook URL',
    fields: [{ name: 'webhookUri', label: 'Webhook URL', type: 'password', placeholder: 'https://discord.com/api/webhooks/…' }],
  },
  {
    type: 'dropboxApi',
    displayName: 'Dropbox API',
    icon: '📦',
    description: 'Connect to Dropbox with an access token',
    fields: [{ name: 'accessToken', label: 'Access Token', type: 'password' }],
  },
  {
    type: 'dropboxOAuth2Api',
    displayName: 'Dropbox OAuth2 API',
    icon: '📦',
    description: 'Connect to Dropbox via OAuth2',
    oauth: true,
    presetData: { authUrl: 'https://www.dropbox.com/oauth2/authorize', accessTokenUrl: 'https://api.dropboxapi.com/oauth2/token' },
    fields: [
      { name: 'clientId', label: 'Client ID', type: 'text' },
      { name: 'clientSecret', label: 'Client Secret', type: 'password' },
    ],
  },
  {
    type: 'freshdeskApi',
    displayName: 'Freshdesk API',
    icon: '🎫',
    description: 'Connect to Freshdesk customer support',
    fields: [
      { name: 'domain', label: 'Domain', type: 'text', placeholder: 'your-company' },
      { name: 'apiKey', label: 'API Key', type: 'password' },
    ],
  },
  {
    type: 'githubApi',
    displayName: 'GitHub API',
    icon: '🐙',
    description: 'Connect to GitHub with a personal access token',
    fields: [{ name: 'accessToken', label: 'Access Token', type: 'password', placeholder: 'ghp_…' }],
  },
  {
    type: 'githubOAuth2Api',
    displayName: 'GitHub OAuth2 API',
    icon: '🐙',
    description: 'Connect to GitHub via OAuth2',
    oauth: true,
    presetData: { authUrl: 'https://github.com/login/oauth/authorize', accessTokenUrl: 'https://github.com/login/oauth/access_token' },
    fields: [
      { name: 'clientId', label: 'Client ID', type: 'text' },
      { name: 'clientSecret', label: 'Client Secret', type: 'password' },
    ],
  },
  {
    type: 'gitlabApi',
    displayName: 'GitLab API',
    icon: '🦊',
    description: 'Connect to GitLab with a personal access token',
    fields: [{ name: 'accessToken', label: 'Access Token', type: 'password' }],
  },
  {
    type: 'gmailOAuth2',
    displayName: 'Gmail OAuth2 API',
    icon: '📬',
    description: 'Connect to Gmail via Google OAuth2',
    oauth: true,
    presetData: { authUrl: 'https://accounts.google.com/o/oauth2/v2/auth', accessTokenUrl: 'https://oauth2.googleapis.com/token', scope: 'https://www.googleapis.com/auth/gmail.modify' },
    fields: [
      { name: 'clientId', label: 'Client ID', type: 'text' },
      { name: 'clientSecret', label: 'Client Secret', type: 'password' },
    ],
  },
  {
    type: 'googleCalendarOAuth2Api',
    displayName: 'Google Calendar OAuth2 API',
    icon: '📆',
    description: 'Connect to Google Calendar via OAuth2',
    oauth: true,
    presetData: { authUrl: 'https://accounts.google.com/o/oauth2/v2/auth', accessTokenUrl: 'https://oauth2.googleapis.com/token', scope: 'https://www.googleapis.com/auth/calendar' },
    fields: [
      { name: 'clientId', label: 'Client ID', type: 'text' },
      { name: 'clientSecret', label: 'Client Secret', type: 'password' },
    ],
  },
  {
    type: 'googleDriveOAuth2Api',
    displayName: 'Google Drive OAuth2 API',
    icon: '📁',
    description: 'Connect to Google Drive via OAuth2',
    oauth: true,
    presetData: { authUrl: 'https://accounts.google.com/o/oauth2/v2/auth', accessTokenUrl: 'https://oauth2.googleapis.com/token', scope: 'https://www.googleapis.com/auth/drive' },
    fields: [
      { name: 'clientId', label: 'Client ID', type: 'text' },
      { name: 'clientSecret', label: 'Client Secret', type: 'password' },
    ],
  },
  {
    type: 'googleSheetsOAuth2Api',
    displayName: 'Google Sheets OAuth2 API',
    icon: '📊',
    description: 'Connect to Google Sheets via OAuth2',
    oauth: true,
    presetData: { authUrl: 'https://accounts.google.com/o/oauth2/v2/auth', accessTokenUrl: 'https://oauth2.googleapis.com/token', scope: 'https://www.googleapis.com/auth/spreadsheets' },
    fields: [
      { name: 'clientId', label: 'Client ID', type: 'text' },
      { name: 'clientSecret', label: 'Client Secret', type: 'password' },
    ],
  },
  {
    type: 'hubspotApi',
    displayName: 'HubSpot API',
    icon: '🧲',
    description: 'Connect to HubSpot with a private app access token',
    fields: [{ name: 'apiKey', label: 'Access Token', type: 'password' }],
  },
  {
    type: 'hubspotOAuth2Api',
    displayName: 'HubSpot OAuth2 API',
    icon: '🧲',
    description: 'Connect to HubSpot via OAuth2',
    oauth: true,
    presetData: { authUrl: 'https://app.hubspot.com/oauth/authorize', accessTokenUrl: 'https://api.hubapi.com/oauth/v1/token' },
    fields: [
      { name: 'clientId', label: 'Client ID', type: 'text' },
      { name: 'clientSecret', label: 'Client Secret', type: 'password' },
    ],
  },
  {
    type: 'intercomApi',
    displayName: 'Intercom API',
    icon: '🗨️',
    description: 'Connect to Intercom with an access token',
    fields: [{ name: 'accessToken', label: 'Access Token', type: 'password' }],
  },
  {
    type: 'jiraApi',
    displayName: 'Jira API',
    icon: '🔷',
    description: 'Connect to Jira with an email and API token',
    fields: [
      { name: 'domain', label: 'Domain', type: 'text', placeholder: 'https://your-domain.atlassian.net' },
      { name: 'email', label: 'Email', type: 'text' },
      { name: 'apiToken', label: 'API Token', type: 'password' },
    ],
  },
  {
    type: 'linearApi',
    displayName: 'Linear API',
    icon: '📐',
    description: 'Connect to Linear with an API key',
    fields: [{ name: 'apiKey', label: 'API Key', type: 'password' }],
  },
  {
    type: 'mailchimpApi',
    displayName: 'Mailchimp API',
    icon: '🐵',
    description: 'Connect to Mailchimp with an API key',
    fields: [{ name: 'apiKey', label: 'API Key', type: 'password' }],
  },
  {
    type: 'mattermostApi',
    displayName: 'Mattermost API',
    icon: '🗣️',
    description: 'Connect to a Mattermost server with an access token',
    fields: [
      { name: 'baseUrl', label: 'Base URL', type: 'text', placeholder: 'https://mattermost.example.com' },
      { name: 'accessToken', label: 'Access Token', type: 'password' },
    ],
  },
  {
    type: 'microsoftOutlookOAuth2Api',
    displayName: 'Microsoft Outlook OAuth2 API',
    icon: '📨',
    description: 'Connect to Microsoft Outlook via OAuth2',
    oauth: true,
    presetData: { authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize', accessTokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token' },
    fields: [
      { name: 'clientId', label: 'Client ID', type: 'text' },
      { name: 'clientSecret', label: 'Client Secret', type: 'password' },
    ],
  },
  {
    type: 'microsoftTeamsOAuth2Api',
    displayName: 'Microsoft Teams OAuth2 API',
    icon: '👥',
    description: 'Connect to Microsoft Teams via OAuth2',
    oauth: true,
    presetData: { authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize', accessTokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token' },
    fields: [
      { name: 'clientId', label: 'Client ID', type: 'text' },
      { name: 'clientSecret', label: 'Client Secret', type: 'password' },
    ],
  },
  {
    type: 'mongoDb',
    displayName: 'MongoDB',
    icon: '🍃',
    description: 'Connect to a MongoDB database',
    fields: [
      { name: 'host', label: 'Host', type: 'text', placeholder: 'localhost' },
      { name: 'port', label: 'Port', type: 'text', placeholder: '27017' },
      { name: 'database', label: 'Database', type: 'text' },
      { name: 'user', label: 'User', type: 'text' },
      { name: 'password', label: 'Password', type: 'password' },
    ],
  },
  {
    type: 'mySql',
    displayName: 'MySQL',
    icon: '🐬',
    description: 'Connect to a MySQL database',
    fields: [
      { name: 'host', label: 'Host', type: 'text', placeholder: 'localhost' },
      { name: 'port', label: 'Port', type: 'text', placeholder: '3306' },
      { name: 'database', label: 'Database', type: 'text' },
      { name: 'user', label: 'User', type: 'text' },
      { name: 'password', label: 'Password', type: 'password' },
    ],
  },
  {
    type: 'notionApi',
    displayName: 'Notion API',
    icon: '📝',
    description: 'Connect to Notion with an internal integration token',
    fields: [{ name: 'apiKey', label: 'Internal Integration Token', type: 'password', placeholder: 'secret_…' }],
  },
  {
    type: 'notionOAuth2Api',
    displayName: 'Notion OAuth2 API',
    icon: '📝',
    description: 'Connect to Notion via OAuth2',
    oauth: true,
    presetData: { authUrl: 'https://api.notion.com/v1/oauth/authorize', accessTokenUrl: 'https://api.notion.com/v1/oauth/token' },
    fields: [
      { name: 'clientId', label: 'Client ID', type: 'text' },
      { name: 'clientSecret', label: 'Client Secret', type: 'password' },
    ],
  },
  {
    type: 'openAiApi',
    displayName: 'OpenAI API',
    icon: '🤖',
    description: 'OpenAI API key',
    fields: [{ name: 'apiKey', label: 'API Key', type: 'password', placeholder: 'sk-…' }],
  },
  {
    type: 'pipedriveApi',
    displayName: 'Pipedrive API',
    icon: '📈',
    description: 'Connect to Pipedrive CRM with an API token',
    fields: [{ name: 'apiToken', label: 'API Token', type: 'password' }],
  },
  {
    type: 'postgres',
    displayName: 'Postgres',
    icon: '🐘',
    description: 'Connect to a PostgreSQL database',
    fields: [
      { name: 'host', label: 'Host', type: 'text', placeholder: 'localhost' },
      { name: 'port', label: 'Port', type: 'text', placeholder: '5432' },
      { name: 'database', label: 'Database', type: 'text' },
      { name: 'user', label: 'User', type: 'text' },
      { name: 'password', label: 'Password', type: 'password' },
    ],
  },
  {
    type: 'redis',
    displayName: 'Redis',
    icon: '🧱',
    description: 'Connect to a Redis server',
    fields: [
      { name: 'host', label: 'Host', type: 'text', placeholder: 'localhost' },
      { name: 'port', label: 'Port', type: 'text', placeholder: '6379' },
      { name: 'database', label: 'Database', type: 'text', placeholder: '0' },
      { name: 'user', label: 'User', type: 'text' },
      { name: 'password', label: 'Password', type: 'password' },
    ],
  },
  {
    type: 'salesforceOAuth2Api',
    displayName: 'Salesforce OAuth2 API',
    icon: '🌩️',
    description: 'Connect to Salesforce via OAuth2',
    oauth: true,
    presetData: { authUrl: 'https://login.salesforce.com/services/oauth2/authorize', accessTokenUrl: 'https://login.salesforce.com/services/oauth2/token' },
    fields: [
      { name: 'clientId', label: 'Client ID', type: 'text' },
      { name: 'clientSecret', label: 'Client Secret', type: 'password' },
    ],
  },
  {
    type: 'sendGridApi',
    displayName: 'SendGrid API',
    icon: '📤',
    description: 'Connect to SendGrid with an API key',
    fields: [{ name: 'apiKey', label: 'API Key', type: 'password', placeholder: 'SG.…' }],
  },
  {
    type: 'shopifyApi',
    displayName: 'Shopify API',
    icon: '🛍️',
    description: 'Connect to a Shopify store with API credentials',
    fields: [
      { name: 'shopSubdomain', label: 'Shop Subdomain', type: 'text', placeholder: 'your-store' },
      { name: 'apiKey', label: 'API Key', type: 'text' },
      { name: 'password', label: 'Password', type: 'password' },
    ],
  },
  {
    type: 'slackApi',
    displayName: 'Slack API',
    icon: '💬',
    description: 'Connect to Slack with a bot or user access token',
    fields: [{ name: 'accessToken', label: 'Access Token', type: 'password', placeholder: 'xoxb-…' }],
  },
  {
    type: 'slackOAuth2Api',
    displayName: 'Slack OAuth2 API',
    icon: '💬',
    description: 'Connect to Slack via OAuth2',
    oauth: true,
    presetData: { authUrl: 'https://slack.com/oauth/v2/authorize', accessTokenUrl: 'https://slack.com/api/oauth.v2.access' },
    fields: [
      { name: 'clientId', label: 'Client ID', type: 'text' },
      { name: 'clientSecret', label: 'Client Secret', type: 'password' },
    ],
  },
  {
    type: 'stripeApi',
    displayName: 'Stripe API',
    icon: '💳',
    description: 'Connect to Stripe with a secret key',
    fields: [{ name: 'secretKey', label: 'Secret Key', type: 'password', placeholder: 'sk_live_…' }],
  },
  {
    type: 'telegramApi',
    displayName: 'Telegram API',
    icon: '✈️',
    description: 'Connect to the Telegram Bot API with a bot token',
    fields: [{ name: 'accessToken', label: 'Bot Token', type: 'password', placeholder: '123456:ABC-…' }],
  },
  {
    type: 'todoistApi',
    displayName: 'Todoist API',
    icon: '☑️',
    description: 'Connect to Todoist with an API token',
    fields: [{ name: 'apiKey', label: 'API Token', type: 'password' }],
  },
  {
    type: 'todoistOAuth2Api',
    displayName: 'Todoist OAuth2 API',
    icon: '☑️',
    description: 'Connect to Todoist via OAuth2',
    oauth: true,
    presetData: { authUrl: 'https://todoist.com/oauth/authorize', accessTokenUrl: 'https://todoist.com/oauth/access_token' },
    fields: [
      { name: 'clientId', label: 'Client ID', type: 'text' },
      { name: 'clientSecret', label: 'Client Secret', type: 'password' },
    ],
  },
  {
    type: 'trelloApi',
    displayName: 'Trello API',
    icon: '📋',
    description: 'Connect to Trello with an API key and token',
    fields: [
      { name: 'apiKey', label: 'API Key', type: 'text' },
      { name: 'apiToken', label: 'API Token', type: 'password' },
    ],
  },
  {
    type: 'trelloOAuth2Api',
    displayName: 'Trello OAuth2 API',
    icon: '📋',
    description: 'Connect to Trello via OAuth',
    oauth: true,
    presetData: { authUrl: 'https://trello.com/1/authorize', accessTokenUrl: 'https://trello.com/1/OAuthGetAccessToken' },
    fields: [
      { name: 'clientId', label: 'Client ID', type: 'text' },
      { name: 'clientSecret', label: 'Client Secret', type: 'password' },
    ],
  },
  {
    type: 'twilioApi',
    displayName: 'Twilio API',
    icon: '📞',
    description: 'Connect to Twilio with an account SID and auth token',
    fields: [
      { name: 'accountSid', label: 'Account SID', type: 'text' },
      { name: 'authToken', label: 'Auth Token', type: 'password' },
    ],
  },
  {
    type: 'zendeskApi',
    displayName: 'Zendesk API',
    icon: '🎧',
    description: 'Connect to Zendesk with an email and API token',
    fields: [
      { name: 'subdomain', label: 'Subdomain', type: 'text', placeholder: 'your-company' },
      { name: 'email', label: 'Email', type: 'text' },
      { name: 'apiToken', label: 'API Token', type: 'password' },
    ],
  },
  {
    type: 'zohoOAuth2Api',
    displayName: 'Zoho CRM OAuth2 API',
    icon: '🧮',
    description: 'Connect to Zoho CRM via OAuth2',
    oauth: true,
    presetData: { authUrl: 'https://accounts.zoho.com/oauth/v2/auth', accessTokenUrl: 'https://accounts.zoho.com/oauth/v2/token' },
    fields: [
      { name: 'clientId', label: 'Client ID', type: 'text' },
      { name: 'clientSecret', label: 'Client Secret', type: 'password' },
    ],
  },
  {
    type: 'zoomOAuth2Api',
    displayName: 'Zoom OAuth2 API',
    icon: '🎥',
    description: 'Connect to Zoom via OAuth2',
    oauth: true,
    presetData: { authUrl: 'https://zoom.us/oauth/authorize', accessTokenUrl: 'https://zoom.us/oauth/token' },
    fields: [
      { name: 'clientId', label: 'Client ID', type: 'text' },
      { name: 'clientSecret', label: 'Client Secret', type: 'password' },
    ],
  },
];

export function credentialTypeMeta(type: string): CredentialTypeMeta | undefined {
  return CREDENTIAL_TYPES.find((t) => t.type === type);
}
