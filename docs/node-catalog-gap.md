# n8n 2.30.4 节点面板全目录 × nomops 缺口分析

> **数据源**:本地 Docker 容器 `n8n`(localhost:5678),铸 owner JWT cookie 后拉取运行时端点 `GET /types/nodes.json` —— 即节点面板前端渲染所用的同一份数据(非 dist 静态精简版)。去重去 hidden 后 **面板可见 808 个节点**。生成日期 2026-07-22。

## 计数口径(先厘清"808"的水分)

| 分层 | 数量 | 对 nomops 的意义 |
|---|---:|---|
| **Core Nodes**(核心构建块:流程控制/数据变换/触发器/HTTP…) | 53 | **必须对标**——平台骨架 |
| **无分类内置节点** | 8 | 多为训练用/边缘,选做 |
| **LangChain / AI 节点** | 105 | AI 能力,按需对标 |
| 真实 app 集成节点(base) | 355 | 长尾 SaaS 连接器,走"社区节点加载机制"而非手写 |
| ↳ 其自动派生的 `*Tool` 变体(usableAsTool) | 266 | 引擎特性,一次实现全覆盖,不逐个算 |
| 已装社区/MCP 包(other) | 21 | 本机额外装的,非 n8n 本体 |
| **面板可见合计** | **808** | 另有 47 个 hidden(弃用) + 在线社区目录 1265 个认证节点(选中才现装) |

**结论口径**:n8n 的"节点数"里,266 个是每个 app 自动派生的 Tool 变体(引擎给的,不是手写的),真正的独立节点约 **521** 个;其中 nomops 必须对标的"平台骨架"是 **Core 53 + AI 105**,app 集成属长尾。

nomops 现有 **30 个节点**(26 核心 + Slack/GitHub/SendGrid/Stripe 4 个声明式集成),外加 n8n 没有的 `PollingTrigger`、`HttpTool`(对应 n8n 已弃用隐藏的 toolHttpRequest)。

## 一、Core Nodes:53 个 → nomops 已覆盖 19,**缺 34**

| n8n 节点 | 显示名 | nomops | 触发器 |
|---|---|---|:--:|
| `aggregate` | Aggregate | ✅ Aggregate |  |
| `aiTransform` | AI Transform | ✅ 已实现 | 编辑期仅发送指令与字段/类型摘要生成只读代码；执行期复用 Code 子进程沙箱，不向模型发送输入值 |
| `code` | Code | ✅ Code |  |
| `compareDatasets` | Compare Datasets | ❌ 缺 |  |
| `compression` | Compression | ❌ 缺 |  |
| `convertToFile` | Convert to File | ❌ 缺 |  |
| `crypto` | Crypto | ❌ 缺 |  |
| `dataTable` | Data table | ✅ DataTable |  |
| `dateTime` | Date & Time | ❌ 缺 |  |
| `editImage` | Edit Image | ❌ 缺 |  |
| `emailReadImap` | Email Trigger (IMAP) | ❌ 缺 | ⚡ |
| `emailSend` | Send Email | ❌ 缺 |  |
| `errorTrigger` | Error Trigger | ✅ ErrorTrigger | ⚡ |
| `executeWorkflow` | Execute Sub-workflow | ✅ ExecuteWorkflow |  |
| `executeWorkflowTrigger` | Execute Workflow Trigger | ✅ ExecuteWorkflowTrigger | ⚡ |
| `executionData` | Execution Data | ❌ 缺 |  |
| `extractFromFile` | Extract from File | ❌ 缺 |  |
| `filter` | Filter | ✅ Filter |  |
| `form` | n8n Form | ❌ 缺 |  |
| `formTrigger` | n8n Form Trigger | ❌ 缺 | ⚡ |
| `ftp` | FTP | ❌ 缺 |  |
| `git` | Git | ❌ 缺 |  |
| `html` | HTML | ❌ 缺 |  |
| `httpRequest` | HTTP Request | ✅ HttpRequest |  |
| `if` | If | ✅ If |  |
| `limit` | Limit | ❌ 缺 |  |
| `manualTrigger` | Manual Trigger | ✅ ManualTrigger | ⚡ |
| `markdown` | Markdown | ❌ 缺 |  |
| `merge` | Merge | ✅ Merge |  |
| `n8n` | n8n | ❌ 缺 |  |
| `n8nTrigger` | n8n Trigger | ❌ 缺 | ⚡ |
| `noOp` | No Operation, do nothing | ✅ NoOp |  |
| `readWriteFile` | Read/Write Files from Disk | ❌ 缺 |  |
| `removeDuplicates` | Remove Duplicates | ❌ 缺 |  |
| `renameKeys` | Rename Keys | ❌ 缺 |  |
| `respondToWebhook` | Respond to Webhook | ✅ RespondToWebhook |  |
| `rssFeedRead` | RSS Read | ❌ 缺 |  |
| `rssFeedReadTrigger` | RSS Feed Trigger | ❌ 缺 | ⚡ |
| `scheduleTrigger` | Schedule Trigger | ✅ Schedule | ⚡ |
| `set` | Edit Fields (Set) | ✅ Set |  |
| `sort` | Sort | ❌ 缺 |  |
| `splitInBatches` | Loop Over Items (Split in Batches) | ✅ Loop |  |
| `splitOut` | Split Out | ✅ SplitOut |  |
| `sseTrigger` | SSE Trigger | ❌ 缺 | ⚡ |
| `ssh` | SSH | ❌ 缺 |  |
| `stopAndError` | Stop and Error | ❌ 缺 |  |
| `summarize` | Summarize | ❌ 缺 |  |
| `switch` | Switch | ✅ Switch |  |
| `timeSaved` | Track Time Saved | ❌ 缺 |  |
| `totp` | TOTP | ❌ 缺 |  |
| `wait` | Wait | ✅ Wait |  |
| `webhook` | Webhook | ✅ Webhook | ⚡ |
| `xml` | XML | ❌ 缺 |  |

**缺口(按落地优先级)**:

- **P0 数据处理高频刚需**:`sort`、`limit`、`removeDuplicates`、`summarize`、`renameKeys`、`compareDatasets`、`dateTime`、`crypto`
- **P0 文件/IO(工作流常用)**:`readWriteFile`、`extractFromFile`、`convertToFile`、`ftp`、`ssh`、`emailSend`、`emailReadImap`
- **P1 格式解析**:`html`、`xml`、`markdown`、`rssFeedRead`、`rssFeedReadTrigger`
- **P1 触发器补全**:`formTrigger`、`form`、`sseTrigger`、`n8nTrigger`
- **P2 流程/工具**:`stopAndError`、`compression`、`editImage`、`executionData`、`git`、`totp`、`n8n`
- **已完成但保持自托管边界**:`aiTransform` 复用实例已配置的 AI provider，不依赖 n8n Cloud；`timeSaved` 仍不做。

## 二、无分类内置节点:8 个

| n8n 节点 | 显示名 |
|---|---|
| `currents` | Currents |
| `currentsTrigger` | Currents Trigger |
| `evaluationTrigger` | Evaluation Trigger |
| `microsoftSharePoint` | Microsoft SharePoint |
| `n8nTrainingCustomerDatastore` | Customer Datastore (n8n training) |
| `n8nTrainingCustomerMessenger` | Customer Messenger (n8n training) |
| `oracleDatabase` | Oracle Database |
| `stickyNote` | Sticky Note |

> `n8nTrainingCustomer*` 是教学 demo 节点;`currents/microsoftSharePoint/oracleDatabase` 属 app 集成(codex 未打分类)。

## 三、LangChain / AI 节点:105 个 → nomops 已覆盖 4,**缺 101**

### Language Models(24)

| n8n 节点 | 显示名 | nomops |
|---|---|---|
| `lmChatAlibabaCloud` | Qwen Cloud Chat Model | ❌ |
| `lmChatAnthropic` | Anthropic Chat Model | ✅ AnthropicChatModel |
| `lmChatAwsBedrock` | AWS Bedrock Chat Model | ❌ |
| `lmChatAzureOpenAi` | Azure OpenAI Chat Model | ❌ |
| `lmChatCohere` | Cohere Chat Model | ❌ |
| `lmChatDeepSeek` | DeepSeek Chat Model | ❌ |
| `lmChatGoogleGemini` | Google Gemini Chat Model | ❌ |
| `lmChatGoogleVertex` | Google Vertex Chat Model | ❌ |
| `lmChatGroq` | Groq Chat Model | ❌ |
| `lmChatLemonade` | Lemonade Chat Model | ❌ |
| `lmChatMinimax` | MiniMax Chat Model | ❌ |
| `lmChatMistralCloud` | Mistral Cloud Chat Model | ❌ |
| `lmChatMoonshot` | Moonshot Kimi Chat Model | ❌ |
| `lmChatNvidia` | NVIDIA Nemotron Chat Model | ❌ |
| `lmChatOllama` | Ollama Chat Model | ❌ |
| `lmChatOpenAi` | OpenAI Chat Model | ❌ |
| `lmChatOpenRouter` | OpenRouter Chat Model | ❌ |
| `lmChatVercelAiGateway` | Vercel AI Gateway Chat Model | ❌ |
| `lmChatXAiGrok` | xAI Grok Chat Model | ❌ |
| `lmCohere` | Cohere Model | ❌ |
| `lmLemonade` | Lemonade Model | ❌ |
| `lmOllama` | Ollama Model | ❌ |
| `lmOpenHuggingFaceInference` | Hugging Face Inference Model | ❌ |
| `modelSelector` | Model Selector | ❌ |

### Tools(17)

| n8n 节点 | 显示名 | nomops |
|---|---|---|
| `agentTool` | AI Agent Tool | ❌ |
| `alibabaCloudTool` | Qwen Cloud Tool | ❌ |
| `anthropicTool` | Anthropic Tool | ❌ |
| `chatHitlTool` | Chat | ❌ |
| `chatTool` | Chat Tool | ❌ |
| `googleGeminiTool` | Google Gemini Tool | ❌ |
| `minimaxTool` | MiniMax Tool | ❌ |
| `moonshotTool` | Moonshot Kimi Tool | ❌ |
| `ollamaTool` | Ollama Tool | ❌ |
| `toolCalculator` | Calculator | ❌ |
| `toolCode` | Code Tool | ❌ |
| `toolSearXng` | SearXNG | ❌ |
| `toolThink` | Think Tool | ❌ |
| `toolVectorStore` | Vector Store Question Answer Tool | ❌ |
| `toolWikipedia` | Wikipedia | ❌ |
| `toolWolframAlpha` | Wolfram|Alpha | ❌ |
| `toolWorkflow` | Call n8n Workflow Tool | ❌ |

### Vector Stores(13)

| n8n 节点 | 显示名 | nomops |
|---|---|---|
| `vectorStoreAzureAISearch` | Azure AI Search Vector Store | ❌ |
| `vectorStoreChromaDB` | Chroma Vector Store | ❌ |
| `vectorStoreInMemory` | Simple Vector Store | ❌ |
| `vectorStoreMilvus` | Milvus Vector Store | ❌ |
| `vectorStoreMongoDBAtlas` | MongoDB Atlas Vector Store | ❌ |
| `vectorStoreOracleDBVector` | Oracle Database Vector Store | ❌ |
| `vectorStorePGVector` | Postgres PGVector Store | ❌ |
| `vectorStorePinecone` | Pinecone Vector Store | ❌ |
| `vectorStoreQdrant` | Qdrant Vector Store | ❌ |
| `vectorStoreRedis` | Redis Vector Store | ❌ |
| `vectorStoreSupabase` | Supabase Vector Store | ❌ |
| `vectorStoreWeaviate` | Weaviate Vector Store | ❌ |
| `vectorStoreZep` | Zep Vector Store | ❌ |

### Embeddings(12)

| n8n 节点 | 显示名 | nomops |
|---|---|---|
| `embeddingsAwsBedrock` | Embeddings AWS Bedrock | ❌ |
| `embeddingsAzureOpenAi` | Embeddings Azure OpenAI | ❌ |
| `embeddingsCohere` | Embeddings Cohere | ❌ |
| `embeddingsGoogleGemini` | Embeddings Google Gemini | ❌ |
| `embeddingsGoogleVertex` | Embeddings Google Vertex | ❌ |
| `embeddingsHuggingFaceInference` | Embeddings Hugging Face Inference | ❌ |
| `embeddingsLemonade` | Embeddings Lemonade | ❌ |
| `embeddingsMistralCloud` | Embeddings Mistral Cloud | ❌ |
| `embeddingsNvidia` | NVIDIA Nemotron Embeddings | ❌ |
| `embeddingsOllama` | Embeddings Ollama | ❌ |
| `embeddingsOpenAi` | Embeddings OpenAI | ❌ |
| `embeddingsOracleDb` | Embeddings Oracle Database | ❌ |

### Agents(9)

| n8n 节点 | 显示名 | nomops |
|---|---|---|
| `agent` | AI Agent | ✅ AiAgent |
| `alibabaCloud` | Qwen Cloud | ❌ |
| `anthropic` | Anthropic | ❌ |
| `googleGemini` | Google Gemini | ❌ |
| `guardrails` | Guardrails | ❌ |
| `minimax` | MiniMax | ❌ |
| `moonshot` | Moonshot Kimi | ❌ |
| `ollama` | Ollama | ❌ |
| `openAi` | OpenAI | ❌ |

### Chains(6)

| n8n 节点 | 显示名 | nomops |
|---|---|---|
| `chainLlm` | Basic LLM Chain | ❌ |
| `chainRetrievalQa` | Question and Answer Chain | ❌ |
| `chainSummarization` | Summarization Chain | ❌ |
| `informationExtractor` | Information Extractor | ❌ |
| `sentimentAnalysis` | Sentiment Analysis | ❌ |
| `textClassifier` | Text Classifier | ❌ |

### Memory(5)

| n8n 节点 | 显示名 | nomops |
|---|---|---|
| `memoryBufferWindow` | Simple Memory | ✅ WindowMemory |
| `memoryMongoDbChat` | MongoDB Chat Memory | ❌ |
| `memoryPostgresChat` | Postgres Chat Memory | ❌ |
| `memoryRedisChat` | Redis Chat Memory | ❌ |
| `memoryXata` | Xata | ❌ |

### 其他(4)

| n8n 节点 | 显示名 | nomops |
|---|---|---|
| `chat` | Chat | ❌ |
| `chatTrigger` | Chat Trigger | ✅ ChatTrigger |
| `mcpClient` | MCP Client | ❌ |
| `microsoftAgent365Trigger` | Microsoft Agent 365 Trigger | ❌ |

### Retrievers(4)

| n8n 节点 | 显示名 | nomops |
|---|---|---|
| `retrieverContextualCompression` | Contextual Compression Retriever | ❌ |
| `retrieverMultiQuery` | MultiQuery Retriever | ❌ |
| `retrieverVectorStore` | Vector Store Retriever | ❌ |
| `retrieverWorkflow` | Workflow Retriever | ❌ |

### Output Parsers(3)

| n8n 节点 | 显示名 | nomops |
|---|---|---|
| `outputParserAutofixing` | Auto-fixing Output Parser | ❌ |
| `outputParserItemList` | Item List Output Parser | ❌ |
| `outputParserStructured` | Structured Output Parser | ❌ |

### Text Splitters(3)

| n8n 节点 | 显示名 | nomops |
|---|---|---|
| `textSplitterCharacterTextSplitter` | Character Text Splitter | ❌ |
| `textSplitterRecursiveCharacterTextSplitter` | Recursive Character Text Splitter | ❌ |
| `textSplitterTokenSplitter` | Token Splitter | ❌ |

### Document Loaders(1)

| n8n 节点 | 显示名 | nomops |
|---|---|---|
| `documentDefaultDataLoader` | Default Data Loader | ❌ |

### Model Context Protocol(1)

| n8n 节点 | 显示名 | nomops |
|---|---|---|
| `mcpClientTool` | MCP Client Tool | ❌ |

### Root Nodes(1)

| n8n 节点 | 显示名 | nomops |
|---|---|---|
| `mcpTrigger` | MCP Server Trigger | ❌ |

### Miscellaneous(1)

| n8n 节点 | 显示名 | nomops |
|---|---|---|
| `memoryManager` | Chat Memory Manager | ❌ |

### Rerankers(1)

| n8n 节点 | 显示名 | nomops |
|---|---|---|
| `rerankerCohere` | Reranker Cohere | ❌ |

**AI 缺口重点**:nomops 只有 `AnthropicChatModel`。同类工作流里用到的 **OpenAI Chat Model / DeepSeek Chat Model** 未实现(DeepSeek 走 OpenAI 协议,做一个可配 baseURL 的"OpenAI 兼容 Chat Model"即可覆盖两者及 Ollama/OpenRouter/Groq 等一大票)。再往后是 Vector Store(13)/Embeddings(12)/Chains(6)/Tools(9) 全空白——RAG 能力整体缺失。

## 四、内置 app 集成节点:355 个 → nomops 已覆盖 4(Slack/GitHub/SendGrid/Stripe 声明式)

这类是长尾 SaaS 连接器,**不建议逐个手写**。manifest.ts 已预留"社区包提供各自清单"的加载口子——对标策略是做**声明式集成框架 + 社区节点加载机制**,而非把 355 个连接器一个个实现。以下按类目列出(⚡=trigger ✅=nomops 已有):

### Communication(85)

AWS SES、Customer.io、Customer.io Trigger⚡、Demio、Discord、Discourse、Disqus、E-goi、Emelia、Emelia Trigger⚡、Form.io Trigger⚡、Formstack Trigger⚡、Freshdesk、GetResponse、GetResponse Trigger⚡、Gmail、Gmail Trigger⚡、Google Business Profile Trigger⚡、Google Chat、Gotify、GoToWebinar、Hacker News、HaloPSA、Help Scout、Help Scout Trigger⚡、Intercom、Iterable、Jotform Trigger⚡、KoBoToolbox、KoBoToolbox Trigger⚡、Lemlist、Lemlist Trigger⚡、Line、MailerLite、MailerLite Trigger⚡、Mailgun、Mailjet、Mailjet Trigger⚡、Mandrill、Matrix、Mattermost、MessageBird、Microsoft Outlook、Microsoft Outlook Trigger⚡、Microsoft Teams、Microsoft Teams Trigger⚡、Mocean、Monica CRM、MQTT Trigger⚡、MSG91、PagerDuty、Plivo、Postmark Trigger⚡、Pushbullet、Pushcut、Pushcut Trigger⚡、Pushover、Reddit、Redis Trigger⚡、RocketChat、Rundeck、Sendy、seven、SIGNL4、Slack✅、Slack Trigger⚡、Telegram、Telegram Trigger⚡、Twilio、Twilio Trigger⚡、Twist、Typeform Trigger⚡、Vero、Vonage、Webex by Cisco、Webex by Cisco Trigger⚡、WhatsApp Business Cloud、WhatsApp Trigger⚡、Wufoo Trigger⚡、Zammad、Zendesk、Zendesk Trigger⚡、Zoho CRM、Zoom、Zulip

### Development(74)

AMQP Sender、AMQP Trigger⚡、AWS Certificate Manager、AWS Cognito、AWS Comprehend、AWS ELB、AWS IAM、AWS Lambda、AWS Rekognition、AWS S3、AWS SNS、AWS SNS Trigger⚡、AWS SQS、AWS Transcribe、Bitbucket Trigger⚡、Bubble、CircleCI、Cloudflare、Cortex、CrateDB、DebugHelper、Elastic Security、Elasticsearch、Facebook Graph API、FileMaker、GitHub✅、Github Trigger⚡、GitLab、GitLab Trigger⚡、Gong、Google Cloud Storage、Grafana、Jenkins、Jira Software、Jira Trigger⚡、JWT、Kafka、Kafka Trigger⚡、Ldap、Metabase、Microsoft Entra ID、Microsoft Graph Security、Microsoft SQL、MISP、MongoDB、MQTT、MySQL、Netlify、Netlify Trigger⚡、Netscaler ADC、Npm、Okta、Peekalink、PostBin、Postgres、Postgres Trigger⚡、RabbitMQ、RabbitMQ Trigger⚡、Redis、S3、Sentry.io、Splunk、Taiga、Taiga Trigger⚡、TheHive、TheHive 5、TheHive 5 Trigger⚡、TheHive Trigger⚡、TravisCI、UptimeRobot、urlscan.io、Venafi TLS Protect Cloud、Venafi TLS Protect Cloud Trigger⚡、Venafi TLS Protect Datacenter

### Data & Storage(38)

Adalo、Airtable、Airtable Trigger⚡、AWS DynamoDB、Azure Cosmos DB、Azure Storage、Baserow、Bitwarden、Box、Box Trigger⚡、Databricks、Dropbox、Google BigQuery、Google Cloud Firestore、Google Cloud Realtime Database、Google Drive、Google Drive Trigger⚡、Google Sheets、Google Sheets Trigger⚡、GraphQL、Grist、Microsoft Excel 365、Microsoft OneDrive、Microsoft OneDrive Trigger⚡、Nextcloud、NocoDB、Odoo、QuestDB、Quick Base、SeaTable、SeaTable Trigger⚡、Snowflake、Stackby、Storyblok、Strapi、Supabase、TimescaleDB、uProc

### Productivity(37)

Acuity Scheduling Trigger⚡、Airtop、Asana、Asana Trigger⚡、Beeminder、Cal.com Trigger⚡、Calendly Trigger⚡、ClickUp、ClickUp Trigger⚡、Clockify、Coda、CoinGecko、Flow、Flow Trigger⚡、Freshservice、Google Calendar、Google Calendar Trigger⚡、Google Tasks、Harvest、Linear、Linear Trigger⚡、Microsoft To Do、Monday.com、Notion、Notion Trigger⚡、Oura、Raindrop、ServiceNow、Strava、Strava Trigger⚡、SyncroMSP、Todoist、Toggl Trigger⚡、Trello、Trello Trigger⚡、Twake、Wekan

### Marketing(36)

ActiveCampaign、ActiveCampaign Trigger⚡、Agile CRM、APITemplate.io、Autopilot、Autopilot Trigger⚡、Bannerbear、Brevo、Brevo Trigger⚡、Cockpit、Contentful、ConvertKit、ConvertKit Trigger⚡、Copper、Facebook Lead Ads Trigger⚡、Facebook Trigger⚡、Freshworks CRM、Ghost、Google Business Profile、Google Slides、HighLevel、LinkedIn、Mailchimp、Mailchimp Trigger⚡、Mautic、Mautic Trigger⚡、Medium、Microsoft Dynamics CRM、QuickChart、SendGrid✅、SurveyMonkey Trigger⚡、Webflow、Webflow Trigger⚡、Wordpress、X (Formerly Twitter)、YouTube

### Sales(31)

Action Network、Affinity、Affinity Trigger⚡、Clearbit、Copper Trigger⚡、Drift、Dropcontact、Eventbrite Trigger⚡、Gumroad Trigger⚡、HubSpot、HubSpot Trigger⚡、Hunter、Keap、Keap Trigger⚡、LoneScale、LoneScale Trigger⚡、Magento 2、Paddle、Phantombuster、Pipedrive、Pipedrive Trigger⚡、Salesforce、Salesforce Trigger⚡、Salesmate、Shopify、Shopify Trigger⚡、Tapfiliate、Unleashed Software、Uplead、WooCommerce、WooCommerce Trigger⚡

### Miscellaneous(15)

BambooHR、DHL、Figma Trigger (Beta)⚡、Google Books、Google Docs、Home Assistant、Jina AI、LingvaNex、NASA、Onfleet、Onfleet Trigger⚡、OpenWeatherMap、Philips Hue、Spotify、Workable Trigger⚡

### Utility(14)

AWS Textract、Bitly、Brandfetch、Clockify Trigger⚡、DeepL、Evaluation、Google Translate、Google Workspace Admin、Mailcheck、Mindee、Mistral AI、One Simple API、OpenThesaurus、Yourls

### Finance & Accounting(13)

Chargebee、Chargebee Trigger⚡、ERPNext、Invoice Ninja、Invoice Ninja Trigger⚡、PayPal、PayPal Trigger⚡、QuickBooks Online、Stripe✅、Stripe Trigger⚡、Wise、Wise Trigger⚡、Xero

### Analytics(10)

Google Ads、Google Analytics、Google Cloud Natural Language、Google Perspective、Humantic AI、Marketstack、PostHog、ProfitWell、SecurityScorecard、Segment

### Miscellaneous (1)

Google Contacts

### AI(1)

Perplexity

## 五、在线社区认证节点:1265 个(未安装)

面板 "Action in an app" 会把 api.n8n.io 的认证社区节点目录(共 1265,分 51 页)混排进来,选中才现装。本机已装 21 个(多为各家 MCP 包 + Jira DC + DeepSeek)。nomops 无需对标这 1265 个,而是提供等价的**社区节点安装/加载能力**。

## 六、给 nomops 的落地建议

1. **优先补 Core Nodes 缺口**(见第一节 P0):`sort`/`limit`/`removeDuplicates`/`summarize`/`dateTime`/`crypto` 这些是任何工作流都会用到的数据处理原子,ROI 最高。
2. **文件 & 远程执行**:`readWriteFile`/`extractFromFile`/`ssh`/`executeCommand`/`emailSend` —— 你现有的 Jira 运维 Agent 工作流就卡在 `ssh`/`postgres` 上。
3. **AI 模型层**:做"OpenAI 兼容 Chat Model"一次性覆盖 OpenAI/DeepSeek/Ollama/Groq/OpenRouter;RAG 全家桶(Vector Store/Embeddings/Chains)按需排期。
4. **app 集成走框架不走堆量**:声明式集成 + 社区节点加载,别陷进 355 个连接器的人海战。
