import type { INodeTypeDescription } from '@nomops/workflow';

/**
 * 声明式集成节点清单：每个节点 = 一份纯数据描述（requestDefaults + 凭证注入 + 各 operation 的 routing）。
 * 端点/字段来自各服务的公开 API 文档；描述与实现均为 nomops 原创。
 * 参数用 displayOptions 按 operation 条件显示；表达式作用域含 $parameter/$json/$vars。
 */

export const slackDescription: INodeTypeDescription = {
  displayName: 'Slack',
  name: 'slack',
  group: ['output'],
  version: 1,
  description: 'Send messages and read channels via the Slack Web API',
  defaults: { name: 'Slack' },
  inputs: ['main'],
  outputs: ['main'],
  credentials: [{ name: 'slackApi', required: true }],
  requestDefaults: { baseUrl: 'https://slack.com/api', headers: { 'content-type': 'application/json' } },
  credentialInjection: { credentialName: 'slackApi', in: 'header', key: 'authorization', template: 'Bearer {{accessToken}}' },
  properties: [
    {
      displayName: 'Operation',
      name: 'operation',
      type: 'options',
      default: 'sendMessage',
      options: [
        {
          name: 'Send Message',
          value: 'sendMessage',
          routing: {
            method: 'POST',
            url: '/chat.postMessage',
            body: { channel: '={{ $parameter.channel }}', text: '={{ $parameter.text }}' },
          },
        },
        {
          name: 'List Channels',
          value: 'listChannels',
          routing: { method: 'GET', url: '/conversations.list', qs: { limit: '={{ $parameter.limit }}' } },
        },
      ],
    },
    {
      displayName: 'Channel',
      name: 'channel',
      type: 'string',
      default: '',
      required: true,
      placeholder: '#general or channel ID',
      displayOptions: { show: { operation: ['sendMessage'] } },
    },
    {
      displayName: 'Text',
      name: 'text',
      type: 'string',
      default: '',
      required: true,
      placeholder: 'Supports expressions, e.g. =Order {{ $json.id }} shipped',
      displayOptions: { show: { operation: ['sendMessage'] } },
    },
    {
      displayName: 'Limit',
      name: 'limit',
      type: 'number',
      default: 100,
      displayOptions: { show: { operation: ['listChannels'] } },
    },
  ],
};

export const githubDescription: INodeTypeDescription = {
  displayName: 'GitHub',
  name: 'github',
  group: ['output'],
  version: 1,
  description: 'Create issues and read repositories via the GitHub REST API',
  defaults: { name: 'GitHub' },
  inputs: ['main'],
  outputs: ['main'],
  credentials: [{ name: 'githubApi', required: true }],
  requestDefaults: {
    baseUrl: 'https://api.github.com',
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'nomops' },
  },
  credentialInjection: { credentialName: 'githubApi', in: 'header', key: 'authorization', template: 'Bearer {{accessToken}}' },
  properties: [
    {
      displayName: 'Operation',
      name: 'operation',
      type: 'options',
      default: 'createIssue',
      options: [
        {
          name: 'Create Issue',
          value: 'createIssue',
          routing: {
            method: 'POST',
            url: '={{ "/repos/" + $parameter.owner + "/" + $parameter.repo + "/issues" }}',
            body: { title: '={{ $parameter.title }}', body: '={{ $parameter.issueBody }}' },
          },
        },
        {
          name: 'List Issues',
          value: 'listIssues',
          routing: {
            method: 'GET',
            url: '={{ "/repos/" + $parameter.owner + "/" + $parameter.repo + "/issues" }}',
            qs: { state: '={{ $parameter.state }}' },
          },
        },
        {
          name: 'Get Repository',
          value: 'getRepo',
          routing: { method: 'GET', url: '={{ "/repos/" + $parameter.owner + "/" + $parameter.repo }}' },
        },
      ],
    },
    { displayName: 'Owner', name: 'owner', type: 'string', default: '', required: true, placeholder: 'octocat' },
    { displayName: 'Repository', name: 'repo', type: 'string', default: '', required: true, placeholder: 'hello-world' },
    {
      displayName: 'Title',
      name: 'title',
      type: 'string',
      default: '',
      required: true,
      displayOptions: { show: { operation: ['createIssue'] } },
    },
    {
      displayName: 'Body',
      name: 'issueBody',
      type: 'string',
      default: '',
      displayOptions: { show: { operation: ['createIssue'] } },
    },
    {
      displayName: 'State',
      name: 'state',
      type: 'options',
      default: 'open',
      options: [
        { name: 'Open', value: 'open' },
        { name: 'Closed', value: 'closed' },
        { name: 'All', value: 'all' },
      ],
      displayOptions: { show: { operation: ['listIssues'] } },
    },
  ],
};

export const sendGridDescription: INodeTypeDescription = {
  displayName: 'SendGrid',
  name: 'sendGrid',
  group: ['output'],
  version: 1,
  description: 'Send transactional email via the SendGrid v3 API',
  defaults: { name: 'SendGrid' },
  inputs: ['main'],
  outputs: ['main'],
  credentials: [{ name: 'sendGridApi', required: true }],
  requestDefaults: { baseUrl: 'https://api.sendgrid.com/v3', headers: { 'content-type': 'application/json' } },
  credentialInjection: { credentialName: 'sendGridApi', in: 'header', key: 'authorization', template: 'Bearer {{apiKey}}' },
  properties: [
    {
      displayName: 'Operation',
      name: 'operation',
      type: 'options',
      default: 'sendEmail',
      options: [
        {
          name: 'Send Email',
          value: 'sendEmail',
          routing: {
            method: 'POST',
            url: '/mail/send',
            body: {
              personalizations: [{ to: [{ email: '={{ $parameter.to }}' }] }],
              from: { email: '={{ $parameter.from }}' },
              subject: '={{ $parameter.subject }}',
              content: [{ type: 'text/plain', value: '={{ $parameter.text }}' }],
            },
          },
        },
      ],
    },
    { displayName: 'To', name: 'to', type: 'string', default: '', required: true, placeholder: 'user@example.com' },
    { displayName: 'From', name: 'from', type: 'string', default: '', required: true, placeholder: 'no-reply@yourdomain.com' },
    { displayName: 'Subject', name: 'subject', type: 'string', default: '', required: true },
    { displayName: 'Text', name: 'text', type: 'string', default: '', required: true },
  ],
};

export const stripeDescription: INodeTypeDescription = {
  displayName: 'Stripe',
  name: 'stripe',
  group: ['transform'],
  version: 1,
  description: 'Read customers and balance from the Stripe API',
  defaults: { name: 'Stripe' },
  inputs: ['main'],
  outputs: ['main'],
  credentials: [{ name: 'stripeApi', required: true }],
  requestDefaults: { baseUrl: 'https://api.stripe.com/v1' },
  credentialInjection: { credentialName: 'stripeApi', in: 'header', key: 'authorization', template: 'Bearer {{secretKey}}' },
  properties: [
    {
      displayName: 'Operation',
      name: 'operation',
      type: 'options',
      default: 'listCustomers',
      options: [
        {
          name: 'List Customers',
          value: 'listCustomers',
          routing: { method: 'GET', url: '/customers', qs: { limit: '={{ $parameter.limit }}' } },
        },
        { name: 'Get Balance', value: 'getBalance', routing: { method: 'GET', url: '/balance' } },
      ],
    },
    {
      displayName: 'Limit',
      name: 'limit',
      type: 'number',
      default: 10,
      displayOptions: { show: { operation: ['listCustomers'] } },
    },
  ],
};

export const notionDescription: INodeTypeDescription = {
  displayName: 'Notion',
  name: 'notion',
  group: ['transform'],
  version: 1,
  description: 'Search pages and list users via the Notion API',
  defaults: { name: 'Notion' },
  inputs: ['main'],
  outputs: ['main'],
  credentials: [{ name: 'notionApi', required: true }],
  requestDefaults: {
    baseUrl: 'https://api.notion.com/v1',
    headers: { 'content-type': 'application/json', 'Notion-Version': '2022-06-28' },
  },
  credentialInjection: { credentialName: 'notionApi', in: 'header', key: 'authorization', template: 'Bearer {{apiKey}}' },
  properties: [
    {
      displayName: 'Operation',
      name: 'operation',
      type: 'options',
      default: 'search',
      options: [
        {
          name: 'Search',
          value: 'search',
          routing: { method: 'POST', url: '/search', body: { query: '={{ $parameter.query }}' } },
        },
        { name: 'List Users', value: 'listUsers', routing: { method: 'GET', url: '/users' } },
      ],
    },
    {
      displayName: 'Query',
      name: 'query',
      type: 'string',
      default: '',
      displayOptions: { show: { operation: ['search'] } },
    },
  ],
};

/** 无凭证的公开 API 示例：证明声明式节点可以完全零配置跑通。 */
export const hackerNewsDescription: INodeTypeDescription = {
  displayName: 'Hacker News',
  name: 'hackerNews',
  group: ['transform'],
  version: 1,
  description: 'Read stories from the public Hacker News API (no credential needed)',
  defaults: { name: 'Hacker News' },
  inputs: ['main'],
  outputs: ['main'],
  requestDefaults: { baseUrl: 'https://hacker-news.firebaseio.com/v0' },
  properties: [
    {
      displayName: 'Operation',
      name: 'operation',
      type: 'options',
      default: 'topStories',
      options: [
        { name: 'Top Story IDs', value: 'topStories', routing: { method: 'GET', url: '/topstories.json' } },
        {
          name: 'Get Item',
          value: 'getItem',
          routing: { method: 'GET', url: '={{ "/item/" + $parameter.itemId + ".json" }}' },
        },
      ],
    },
    {
      displayName: 'Item ID',
      name: 'itemId',
      type: 'string',
      default: '',
      placeholder: 'Supports expressions, e.g. ={{ $json.id }}',
      displayOptions: { show: { operation: ['getItem'] } },
    },
  ],
};

export const integrationDescriptions: INodeTypeDescription[] = [
  slackDescription,
  githubDescription,
  sendGridDescription,
  stripeDescription,
  notionDescription,
  hackerNewsDescription,
];
