/**
 * 营销站内容数据（对标 n8n.io 的信息架构，文案为 nomops 原创）。
 * MarketingNav 读 menu 结构；FeatureView / HubView 按 route.path 取内容。
 */

export interface NavItem {
  title: string;
  desc?: string;
  to?: string; // 内部路由
  href?: string; // 外部链接
  icon?: string;
}

export interface NavMenu {
  label: string;
  to?: string; // 顶层可直接跳转（Enterprise / Pricing）
  columns?: NavItem[][]; // 下拉分组
}

/* ── 顶部导航结构 ── */
export const navMenus: NavMenu[] = [
  {
    label: 'Product',
    to: '/product',
    columns: [
      [
        { title: 'Product overview', desc: 'Automate anything, from a two-step trigger to a full agent.', to: '/product', icon: '◆' },
        { title: 'Integrations', desc: 'Move and transform data between the apps your team already uses.', to: '/product/integrations', icon: '🔗' },
        { title: 'Templates', desc: 'Start from a ready-made workflow and make it yours.', to: '/product/templates', icon: '📋' },
        { title: 'AI', desc: 'Build agents you can inspect, on models you choose.', to: '/product/ai', icon: '🤖' },
      ],
    ],
  },
  {
    label: 'Use cases',
    to: '/use-cases',
    columns: [
      [
        { title: 'Building AI agents', to: '/use-cases/building-ai-agents' },
        { title: 'RAG', to: '/use-cases/rag' },
        { title: 'IT operations', to: '/use-cases/it-operations' },
        { title: 'Security operations', to: '/use-cases/security-operations' },
        { title: 'Lead automation', to: '/use-cases/lead-automation' },
      ],
      [
        { title: 'Supercharge your CRM', to: '/use-cases/crm' },
        { title: 'Limitless integrations', to: '/use-cases/integrations' },
        { title: 'Backend prototyping', to: '/use-cases/backend-prototyping' },
        { title: 'Embedding nomops', to: '/use-cases/embed' },
        { title: 'Case studies', to: '/use-cases/case-studies' },
      ],
    ],
  },
  {
    label: 'Docs',
    to: '/docs',
    columns: [
      [
        { title: 'Self-host nomops', desc: 'Run the whole platform on your own infrastructure.', to: '/docs/self-host' },
        { title: 'Documentation', desc: 'Guides, node reference and the expression language.', to: '/docs/documentation' },
        { title: 'Our license', desc: 'Fair-code: source available, self-host friendly.', to: '/docs/license' },
        { title: 'Release notes', desc: "What's new in every version.", to: '/docs/release-notes' },
      ],
    ],
  },
  {
    label: 'Community',
    to: '/community',
    columns: [
      [
        { title: 'Forum', to: '/community/forum' },
        { title: 'Discord', to: '/community/discord' },
        { title: 'Careers', to: '/community/careers' },
        { title: 'Blog', to: '/community/blog' },
        { title: 'Creators', to: '/community/creators' },
      ],
      [
        { title: 'Contribute', to: '/community/contribute' },
        { title: 'Partners', to: '/community/partners' },
        { title: 'Hire an expert', to: '/community/hire-an-expert' },
        { title: 'Events', to: '/community/events' },
        { title: 'Support', to: '/community/support' },
      ],
    ],
  },
  { label: 'Enterprise', to: '/enterprise' },
  { label: 'Pricing', to: '/pricing' },
];

/* ── Feature 页（Product / Use cases / Docs / Community 详情），按 route.path 取 ── */
export interface FeatureSection {
  h3: string;
  p: string;
  checks?: string[];
}
export interface FeaturePage {
  eyebrow?: string;
  title: string;
  highlight?: string; // 标题里高亮的后半段（灰色两色效果）
  sub: string;
  primaryCta?: { label: string; to: string };
  secondaryCta?: { label: string; to: string };
  visual?: string; // emoji 组，装饰面板
  sections: FeatureSection[];
  closing?: { title: string; sub: string; cta: { label: string; to: string } };
}

const START = { label: 'Get started for free', to: '/signup' };
const SALES = { label: 'Talk to sales', to: '/enterprise' };

export const featurePages: Record<string, FeaturePage> = {
  // 法务占位页（对标 n8n 的 /legal/*）：真实可达，非死链。内容为通用模板，
  // 部署方应替换为自己的正式条款——页内已明示。
  '/docs/terms': {
    eyebrow: 'Legal',
    title: 'Terms of',
    highlight: 'Service',
    sub: 'These are placeholder terms for a nomops deployment. Replace this text with your own agreement before going to production.',
    sections: [
      { h3: 'Using the service', p: 'By creating an account or an instance you agree to use nomops lawfully and not to disrupt the service for others. Your workflows, credentials and data remain yours.' },
      { h3: 'Availability', p: 'Self-hosted deployments run on infrastructure you control. Hosted plans are provided on an as-is basis; the operator of this deployment sets any availability commitments.' },
      { h3: 'This is a template', p: 'This page ships as a starting point. The operator of this deployment is responsible for publishing binding Terms of Service that reflect their jurisdiction and offering.' },
    ],
  },
  '/docs/privacy': {
    eyebrow: 'Legal',
    title: 'Privacy',
    highlight: 'Policy',
    sub: 'This is a placeholder privacy policy for a nomops deployment. Replace it with your own before collecting real user data.',
    sections: [
      { h3: 'What we store', p: 'Account email and password hash live in the control plane; workflow, credential and execution data live inside your instance. Decrypted credentials exist only for the length of a run and are never logged or returned by the API.' },
      { h3: 'Your control', p: 'You can delete workflows, credentials and instances at any time. Self-hosting keeps all data on infrastructure you own.' },
      { h3: 'This is a template', p: 'The operator of this deployment must publish a binding privacy policy describing the data they actually collect, retain and process.' },
    ],
  },
  '/product': {
    eyebrow: 'Product',
    title: 'One canvas for',
    highlight: 'every automation',
    sub: 'From a two-step notification to a multi-agent system, nomops gives you one place to build, run and watch it — visually, with code whenever you need it.',
    primaryCta: START,
    secondaryCta: { label: 'See pricing', to: '/pricing' },
    visual: '◆🔗🤖',
    sections: [
      { h3: 'Visual first, code when it counts', p: 'Drag nodes onto the canvas to shape the flow, then drop into JavaScript or Python for the parts that need it. No context-switch, no lock-in.' },
      { h3: 'See every run', p: 'Inspect the input and output of each step right next to its settings. Re-run a single node instead of the whole workflow.' },
      { h3: 'Connect anything', p: 'Hundreds of pre-built nodes for common apps, plus a generic HTTP node and custom credentials for the long tail.', checks: ['Pre-built app nodes', 'Custom API connections', 'Reusable credentials'] },
      { h3: 'Runs where you decide', p: 'Self-host with Docker for full data control, or let us host it. Same platform, your choice.', checks: ['Deploy with Docker', 'Full source access', 'Hosted option available'] },
    ],
    closing: { title: 'Build your first workflow in minutes', sub: 'No credit card required.', cta: START },
  },
  '/product/integrations': {
    eyebrow: 'Product · Integrations',
    title: 'Connect the apps your',
    highlight: 'team already runs on',
    sub: 'Move and transform data between the tools you use every day. Pre-built nodes for the common ones, a generic HTTP node and custom credentials for everything else.',
    primaryCta: START,
    secondaryCta: { label: 'Browse the canvas', to: '/product' },
    visual: '💬📮🗄️🤖',
    sections: [
      { h3: 'Pre-built nodes', p: 'Chat, email, databases, CRMs, cloud storage, ticketing and more — configure them in a form, wire them together on the canvas.' },
      { h3: 'The long tail, covered', p: 'If there is no node yet, the HTTP Request node talks to any REST API. Store the credentials once and reuse them everywhere.' },
      { h3: 'Credentials stay secret', p: 'Secrets are encrypted at rest and never returned by the API or written to logs. Decrypted values exist only for the length of a run.', checks: ['Encrypted at rest', 'Never logged or exported', 'OAuth2 built in'] },
    ],
    closing: { title: 'Wire up your stack', sub: 'Start connecting apps today.', cta: START },
  },
  '/product/templates': {
    eyebrow: 'Product · Templates',
    title: 'Start from a',
    highlight: 'working workflow',
    sub: "Don't start from a blank canvas. Begin with a ready-made template, see how it is built, and adapt it to your own tools and logic.",
    primaryCta: START,
    secondaryCta: { label: 'Open the app', to: '/signup' },
    visual: '📋⚡🧩',
    sections: [
      { h3: 'Learn by example', p: 'Every template is a real workflow you can open, run and take apart. It is the fastest way to learn how the nodes fit together.' },
      { h3: 'Adapt, don’t rebuild', p: 'Swap in your own apps and credentials, change the logic, and ship. The scaffolding is already done.' },
      { h3: 'Share your own', p: 'Turn a workflow your team relies on into a template and reuse it across projects.' },
    ],
    closing: { title: 'Pick a template and go', sub: 'Adapt it in minutes.', cta: START },
  },
  '/product/ai': {
    eyebrow: 'Product · AI',
    title: 'AI agents you can',
    highlight: 'actually follow',
    sub: 'Connect any model, inspect every decision, and keep a human in the loop. Build complex AI without getting boxed in.',
    primaryCta: START,
    secondaryCta: SALES,
    visual: '🤖🧠🔍',
    sections: [
      { h3: 'Any model, cloud or local', p: 'Mix providers, run offline models, and integrate legacy systems while staying ready for the future with MCP support.' },
      { h3: 'Inspect every step', p: 'The agent’s reasoning shows up on the canvas. See what it read, what it decided, and what it did next.' },
      { h3: 'Guardrails and approvals', p: 'Enforce structured inputs and outputs, and combine human-in-the-loop approvals with rule-based automation to contain what AI can do.', checks: ['Structured I/O', 'Human-in-the-loop', 'Native evaluations'] },
    ],
    closing: { title: 'Build an agent you can explain', sub: 'Start for free.', cta: START },
  },

  /* ── Use cases ── */
  '/use-cases/building-ai-agents': {
    eyebrow: 'Use case', title: 'Build AI agents', highlight: 'that stay on the rails',
    sub: 'Design multi-step agents on a canvas where every tool call, model choice and decision is visible and testable.',
    primaryCta: START, secondaryCta: SALES, visual: '🤖🧩⚡',
    sections: [
      { h3: 'Composable tools', p: 'Give an agent the exact tools it needs as nodes — a database lookup, an API call, a Slack message — and nothing it does not.' },
      { h3: 'Deterministic where it matters', p: 'Wrap model calls in rule-based logic so the risky parts are contained and the predictable parts stay predictable.' },
      { h3: 'Test with real data', p: 'Replay real inputs and evaluate outputs before anything reaches a customer.' },
    ],
    closing: { title: 'Ship an agent this week', sub: 'Free to start.', cta: START },
  },
  '/use-cases/rag': {
    eyebrow: 'Use case', title: 'Retrieval-augmented', highlight: 'generation, wired up',
    sub: 'Connect your knowledge sources, embed and store them, and ground model answers in your own data.',
    primaryCta: START, secondaryCta: SALES, visual: '🗄️🧠🔎',
    sections: [
      { h3: 'Ingest from anywhere', p: 'Pull documents from storage, databases or APIs on a schedule or a trigger, and keep your index fresh.' },
      { h3: 'Bring your own vector store', p: 'Use the embedding model and vector database you prefer — the flow stays the same on the canvas.' },
      { h3: 'Answer with sources', p: 'Return grounded answers with the context that produced them, so responses are auditable.' },
    ],
    closing: { title: 'Ground your AI in your data', sub: 'Start building.', cta: START },
  },
  '/use-cases/it-operations': {
    eyebrow: 'Use case', title: 'IT operations', highlight: 'on autopilot',
    sub: 'Onboard employees, sync systems and resolve tickets with workflows your team can read and audit.',
    primaryCta: START, secondaryCta: SALES, visual: '🖥️🔁🔔',
    sections: [
      { h3: 'Onboard and offboard', p: 'Provision accounts across your stack the moment a record changes, and reverse it just as cleanly.' },
      { h3: 'Keep systems in sync', p: 'Move data between your directory, HR system and tools without brittle scripts nobody wants to touch.' },
      { h3: 'Act on alerts', p: 'Turn monitoring alerts into triaged, assigned tickets with the right context attached.' },
    ],
    closing: { title: 'Automate the busywork', sub: 'Free to start.', cta: START },
  },
  '/use-cases/security-operations': {
    eyebrow: 'Use case', title: 'Security operations', highlight: 'that scale',
    sub: 'Enrich incidents, orchestrate response and keep a full audit trail — low-code, with room to drop into code.',
    primaryCta: START, secondaryCta: SALES, visual: '🛡️🚨🔒',
    sections: [
      { h3: 'Enrich automatically', p: 'Pull context from your threat-intel and asset sources the moment an alert lands, so analysts start with the full picture.' },
      { h3: 'Orchestrate response', p: 'Contain, notify and ticket in one workflow, with human approval on the steps that need it.' },
      { h3: 'Audit everything', p: 'Every run is logged and replayable, so you can show exactly what happened and when.' },
    ],
    closing: { title: 'Give your SOC leverage', sub: 'Talk to us.', cta: SALES },
  },
  '/use-cases/lead-automation': {
    eyebrow: 'Use case', title: 'Lead automation', highlight: 'without the glue code',
    sub: 'Capture, enrich, score and route leads to the right place the moment they arrive.',
    primaryCta: START, secondaryCta: SALES, visual: '🎯📈✉️',
    sections: [
      { h3: 'Capture from anywhere', p: 'Forms, webhooks, inboxes and ad platforms all land in one flow.' },
      { h3: 'Enrich and score', p: 'Add firmographic data and let rules or a model score each lead before it reaches sales.' },
      { h3: 'Route instantly', p: 'Push qualified leads into your CRM and notify the right rep in seconds, not days.' },
    ],
    closing: { title: 'Never drop a lead again', sub: 'Start free.', cta: START },
  },
  '/use-cases/crm': {
    eyebrow: 'Use case', title: 'Supercharge', highlight: 'your CRM',
    sub: 'Keep your CRM clean, current and connected to the rest of your stack — automatically.',
    primaryCta: START, secondaryCta: SALES, visual: '📇🔄⚡',
    sections: [
      { h3: 'No more stale records', p: 'Sync contacts and companies across your tools so everyone sees the same truth.' },
      { h3: 'Summaries on tap', p: 'Generate account summaries and next-step suggestions from meeting notes and activity.' },
      { h3: 'Trigger the follow-up', p: 'Fire the right sequence when a deal stage changes — no manual handoffs.' },
    ],
    closing: { title: 'Make your CRM work for you', sub: 'Free to start.', cta: START },
  },
  '/use-cases/integrations': {
    eyebrow: 'Use case', title: 'Limitless', highlight: 'integrations',
    sub: 'If it has an API, nomops can talk to it. Connect the apps you rely on and the ones you build yourself.',
    primaryCta: START, secondaryCta: { label: 'See integrations', to: '/product/integrations' }, visual: '🔗🧩🌐',
    sections: [
      { h3: 'Pre-built where it helps', p: 'Common apps come with ready nodes so you configure a form instead of reading docs.' },
      { h3: 'HTTP for everything else', p: 'The generic HTTP node reaches any REST API, with reusable, encrypted credentials.' },
      { h3: 'Your own nodes', p: 'Extend nomops with custom nodes when you need first-class support for an internal system.' },
    ],
    closing: { title: 'Connect your whole stack', sub: 'Start for free.', cta: START },
  },
  '/use-cases/backend-prototyping': {
    eyebrow: 'Use case', title: 'Prototype backends', highlight: 'in an afternoon',
    sub: 'Stand up webhooks, scheduled jobs and API glue on a canvas — ship the prototype, then harden it.',
    primaryCta: START, secondaryCta: SALES, visual: '⚙️🔌⚡',
    sections: [
      { h3: 'Endpoints in minutes', p: 'Expose a webhook, validate the payload and respond — no boilerplate server to maintain.' },
      { h3: 'Scheduled jobs', p: 'Run recurring tasks on a cron trigger with retries and logs built in.' },
      { h3: 'Real code when you need it', p: 'Drop into JavaScript or Python for the logic that does not fit a node.' },
    ],
    closing: { title: 'From idea to endpoint', sub: 'Start free.', cta: START },
  },
  '/use-cases/embed': {
    eyebrow: 'Use case', title: 'Embed nomops', highlight: 'in your product',
    sub: 'Give your own users a workflow builder without building one from scratch.',
    primaryCta: SALES, secondaryCta: { label: 'See enterprise', to: '/enterprise' }, visual: '🧩🖼️🔧',
    sections: [
      { h3: 'White-label the canvas', p: 'Bring the visual builder into your product with your own branding.' },
      { h3: 'Programmatic control', p: 'Create, run and manage workflows through the API on behalf of your users.' },
      { h3: 'Isolation by design', p: 'Every tenant’s data and credentials stay scoped and separate.' },
    ],
    closing: { title: 'Embed a builder users love', sub: 'Talk to our team.', cta: SALES },
  },
  '/use-cases/case-studies': {
    eyebrow: 'Case studies', title: 'Teams building with', highlight: 'nomops',
    sub: 'Illustrative examples of what technical teams ship when automation is something they can read, replay and hand off.',
    primaryCta: START, secondaryCta: SALES,
    sections: [
      { h3: 'Platform team · 1,000 hours saved', p: '“The brittle cron scripts nobody wanted to touch are now workflows we can watch, replay and hand off.” — Illustrative example.' },
      { h3: 'Security team · faster response', p: '“nomops gave us SOAR-style orchestration in a low-code model, with room to code the complex parts.” — Illustrative example.' },
      { h3: 'Data team · AI in production', p: '“It let us put AI into real processes in a controlled, reviewable way — not a black box.” — Illustrative example.' },
    ],
    closing: { title: 'Write your own story', sub: 'Start for free.', cta: START },
  },

  /* ── Docs ── */
  '/docs/self-host': {
    eyebrow: 'Docs', title: 'Self-host', highlight: 'nomops',
    sub: 'Run the entire platform on your own infrastructure with Docker. Your data and credentials never leave your environment.',
    primaryCta: { label: 'Read the guide', to: '/docs/documentation' }, secondaryCta: START, visual: '🐳🔒🖥️',
    sections: [
      { h3: 'One command to start', p: 'Bring up the community edition with docker compose up and open the editor in your browser.' },
      { h3: 'Bring your own database', p: 'Start on SQLite for a quick spin-up, move to PostgreSQL for production.' },
      { h3: 'Scale when you need to', p: 'Add a queue and workers to run executions in parallel as your usage grows.' },
    ],
  },
  '/docs/documentation': {
    eyebrow: 'Docs', title: 'Documentation', highlight: 'and guides',
    sub: 'Everything from your first workflow to advanced expressions, custom nodes and deployment.',
    primaryCta: START, secondaryCta: { label: 'Self-host guide', to: '/docs/self-host' }, visual: '📚🧭🔧',
    sections: [
      { h3: 'Get started', p: 'Build, run and activate your first workflow, then learn how triggers and nodes fit together.' },
      { h3: 'The expression language', p: 'Reference data from earlier steps with {{ }} expressions, variables and helpers.' },
      { h3: 'Extend nomops', p: 'Write custom nodes and credentials to bring your own systems onto the canvas.' },
    ],
  },
  '/docs/license': {
    eyebrow: 'Docs', title: 'Our', highlight: 'license',
    sub: 'nomops is fair-code: the source is available, self-hosting is free, and the terms are written to be readable.',
    primaryCta: { label: 'Self-host nomops', to: '/docs/self-host' }, secondaryCta: START, visual: '📄⚖️🔓',
    sections: [
      { h3: 'Source available', p: 'Read the whole codebase and run it yourself. No black boxes.' },
      { h3: 'Free to self-host', p: 'Use the community edition on your own infrastructure at no cost.' },
      { h3: 'Fair by design', p: 'The license keeps the project sustainable while staying friendly to the people who build on it.' },
    ],
  },
  '/docs/release-notes': {
    eyebrow: 'Docs', title: 'Release', highlight: 'notes',
    sub: "What's new in every version — features, fixes and the occasional breaking change, written plainly.",
    primaryCta: { label: 'Read the docs', to: '/docs/documentation' }, secondaryCta: START, visual: '🗒️✨🔁',
    sections: [
      { h3: 'Ship often', p: 'New nodes, editor improvements and platform features land on a steady cadence.' },
      { h3: 'Upgrade with confidence', p: 'Breaking changes are called out clearly with migration notes.' },
      { h3: 'Follow along', p: 'Subscribe to the notes to know what changed before you upgrade.' },
    ],
  },

  /* ── Community（内部页；外部社交在 hub 里用外链） ── */
  '/community/careers': {
    eyebrow: 'Community', title: 'Build the future of', highlight: 'automation with us',
    sub: 'We are a small team shipping a platform that technical people love. If that sounds like you, say hello.',
    primaryCta: { label: 'See open roles', to: '/community/careers' }, secondaryCta: { label: 'Learn about nomops', to: '/product' }, visual: '💼🚀🌍',
    sections: [
      { h3: 'Remote-first', p: 'Work from where you do your best thinking, with teammates across time zones.' },
      { h3: 'Own real problems', p: 'Small team, big surface area — you will ship things people use on day one.' },
      { h3: 'Build in the open', p: 'Our source is available and our community is part of how we build.' },
    ],
  },
  '/community/blog': {
    eyebrow: 'Community', title: 'The nomops', highlight: 'blog',
    sub: 'Deep dives, product updates and patterns for building automation that lasts.',
    primaryCta: START, secondaryCta: { label: 'Read the docs', to: '/docs/documentation' }, visual: '✍️📰💡',
    sections: [
      { h3: 'Build patterns', p: 'Practical write-ups on structuring workflows, agents and integrations.' },
      { h3: 'Product updates', p: 'What we shipped and why, straight from the team.' },
      { h3: 'From the community', p: 'Guest posts and workflows from people building with nomops.' },
    ],
  },
  '/community/creators': {
    eyebrow: 'Community', title: 'For', highlight: 'creators',
    sub: 'Share workflows, publish templates and help others automate what you have already figured out.',
    primaryCta: START, secondaryCta: { label: 'Browse templates', to: '/product/templates' }, visual: '🎨🧩⭐',
    sections: [
      { h3: 'Publish templates', p: 'Turn a workflow you are proud of into a template others can start from.' },
      { h3: 'Grow an audience', p: 'Build a reputation as a go-to automation creator in the community.' },
      { h3: 'Get featured', p: 'Standout workflows get highlighted to the whole community.' },
    ],
  },
  '/community/contribute': {
    eyebrow: 'Community', title: 'Contribute to', highlight: 'nomops',
    sub: 'The source is available and contributions are welcome — from a new node to a docs fix.',
    primaryCta: { label: 'Read the docs', to: '/docs/documentation' }, secondaryCta: { label: 'Our license', to: '/docs/license' }, visual: '🛠️🔀💚',
    sections: [
      { h3: 'Build a node', p: 'Add first-class support for an app or system the community needs.' },
      { h3: 'Improve the docs', p: 'Clear docs help everyone — small fixes are hugely appreciated.' },
      { h3: 'Report and fix', p: 'File issues, propose changes, and help shape the roadmap.' },
    ],
  },
  '/community/partners': {
    eyebrow: 'Community', title: 'Partner with', highlight: 'nomops',
    sub: 'Build with us — as an implementation partner, a technology integration, or a reseller.',
    primaryCta: SALES, secondaryCta: { label: 'Enterprise', to: '/enterprise' }, visual: '🤝🌐🔧',
    sections: [
      { h3: 'Solution partners', p: 'Deliver automation projects for clients on top of nomops.' },
      { h3: 'Technology partners', p: 'Integrate your product so it works seamlessly on the canvas.' },
      { h3: 'Grow together', p: 'Access enablement, support and co-marketing.' },
    ],
  },
  '/community/hire-an-expert': {
    eyebrow: 'Community', title: 'Hire an', highlight: 'expert',
    sub: 'Need a workflow built or a deployment hardened? Work with someone who knows nomops inside out.',
    primaryCta: SALES, secondaryCta: { label: 'Become a partner', to: '/community/partners' }, visual: '🧑‍💻⚡🎯',
    sections: [
      { h3: 'Vetted experts', p: 'Connect with people who have shipped real automation on nomops.' },
      { h3: 'Any scope', p: 'From a single workflow to a full platform rollout.' },
      { h3: 'Move faster', p: 'Skip the learning curve and get to production sooner.' },
    ],
  },
  '/community/events': {
    eyebrow: 'Community', title: 'Events and', highlight: 'meetups',
    sub: 'Workshops, webinars and community meetups — online and in person.',
    primaryCta: START, secondaryCta: { label: 'Join the forum', to: '/community/forum' }, visual: '📅🎤🌍',
    sections: [
      { h3: 'Live workshops', p: 'Build alongside the team and level up your automation skills.' },
      { h3: 'Community meetups', p: 'Meet other builders near you and swap workflows.' },
      { h3: 'On demand', p: 'Missed one? Recordings are there when you are.' },
    ],
  },
  '/community/support': {
    eyebrow: 'Community', title: 'Get', highlight: 'support',
    sub: 'Community help for everyone, and dedicated support for teams that need it.',
    primaryCta: { label: 'Ask the forum', to: '/community/forum' }, secondaryCta: SALES, visual: '💬🛟📗',
    sections: [
      { h3: 'Community forum', p: 'Search thousands of answered questions or ask your own.' },
      { h3: 'Docs and guides', p: 'Most answers are a search away in the documentation.' },
      { h3: 'Priority support', p: 'Enterprise plans include dedicated support with response-time commitments.' },
    ],
  },
  '/community/forum': {
    eyebrow: 'Community', title: 'The nomops', highlight: 'forum',
    sub: 'Ask questions, share workflows and learn from thousands of builders.',
    primaryCta: START, secondaryCta: { label: 'Read the docs', to: '/docs/documentation' }, visual: '💬🧠🔎',
    sections: [
      { h3: 'Get unblocked', p: 'Chances are someone has already solved what you are stuck on.' },
      { h3: 'Share what you built', p: 'Post your workflows and get feedback from the community.' },
      { h3: 'Help others', p: 'Answering questions is the fastest way to master the platform.' },
    ],
  },
  '/community/discord': {
    eyebrow: 'Community', title: 'Join us on', highlight: 'Discord',
    sub: 'Chat with the community and the team in real time.',
    primaryCta: START, secondaryCta: { label: 'Visit the forum', to: '/community/forum' }, visual: '🎮💬⚡',
    sections: [
      { h3: 'Real-time help', p: 'Get quick answers and swap ideas as you build.' },
      { h3: 'Show and tell', p: 'Share what you are working on and get inspired.' },
      { h3: 'Stay in the loop', p: 'Hear about releases, events and community projects first.' },
    ],
  },
};

/* ── Hub 页（Use cases / Docs / Community 落地聚合），按 route.path 取 ── */
export interface HubCard {
  title: string;
  desc: string;
  to?: string;
  icon?: string;
}
export interface HubPage {
  eyebrow?: string;
  title: string;
  highlight?: string;
  sub: string;
  cards: HubCard[];
}

export const hubPages: Record<string, HubPage> = {
  '/use-cases': {
    eyebrow: 'Use cases',
    title: 'What will you',
    highlight: 'automate first?',
    sub: 'From AI agents to IT ops, teams use nomops to replace brittle scripts with workflows they can read, replay and hand off.',
    cards: [
      { title: 'Building AI agents', desc: 'Multi-step agents you can inspect and contain.', to: '/use-cases/building-ai-agents', icon: '🤖' },
      { title: 'RAG', desc: 'Ground model answers in your own data.', to: '/use-cases/rag', icon: '🧠' },
      { title: 'IT operations', desc: 'Onboarding, sync and ticketing on autopilot.', to: '/use-cases/it-operations', icon: '🖥️' },
      { title: 'Security operations', desc: 'Enrich incidents and orchestrate response.', to: '/use-cases/security-operations', icon: '🛡️' },
      { title: 'Lead automation', desc: 'Capture, enrich, score and route leads.', to: '/use-cases/lead-automation', icon: '🎯' },
      { title: 'Supercharge your CRM', desc: 'Keep records clean, current and connected.', to: '/use-cases/crm', icon: '📇' },
      { title: 'Limitless integrations', desc: 'If it has an API, nomops can reach it.', to: '/use-cases/integrations', icon: '🔗' },
      { title: 'Backend prototyping', desc: 'Webhooks, jobs and API glue in an afternoon.', to: '/use-cases/backend-prototyping', icon: '⚙️' },
      { title: 'Embedding nomops', desc: 'A workflow builder inside your own product.', to: '/use-cases/embed', icon: '🧩' },
      { title: 'Case studies', desc: 'What teams ship with nomops.', to: '/use-cases/case-studies', icon: '📈' },
    ],
  },
  '/docs': {
    eyebrow: 'Docs',
    title: 'Everything you need to',
    highlight: 'build and self-host',
    sub: 'Guides, references and deployment docs — from your first workflow to running nomops in production.',
    cards: [
      { title: 'Self-host nomops', desc: 'Run the platform on your own infrastructure with Docker.', to: '/docs/self-host', icon: '🐳' },
      { title: 'Documentation', desc: 'Guides, node reference and the expression language.', to: '/docs/documentation', icon: '📚' },
      { title: 'Our license', desc: 'Fair-code: source available, self-host friendly.', to: '/docs/license', icon: '⚖️' },
      { title: 'Release notes', desc: "What's new in every version.", to: '/docs/release-notes', icon: '🗒️' },
    ],
  },
  '/community': {
    eyebrow: 'Community',
    title: 'Built with a',
    highlight: 'community of builders',
    sub: 'Get help, share workflows, contribute code and meet other people automating their work with nomops.',
    cards: [
      { title: 'Forum', desc: 'Ask questions and share what you built.', to: '/community/forum', icon: '💬' },
      { title: 'Discord', desc: 'Chat with the community in real time.', to: '/community/discord', icon: '🎮' },
      { title: 'Careers', desc: 'Help build the future of automation.', to: '/community/careers', icon: '💼' },
      { title: 'Blog', desc: 'Deep dives, patterns and product updates.', to: '/community/blog', icon: '✍️' },
      { title: 'Creators', desc: 'Publish templates and grow an audience.', to: '/community/creators', icon: '🎨' },
      { title: 'Contribute', desc: 'Add a node, fix a doc, shape the roadmap.', to: '/community/contribute', icon: '🛠️' },
      { title: 'Partners', desc: 'Build with us as a partner or integration.', to: '/community/partners', icon: '🤝' },
      { title: 'Hire an expert', desc: 'Work with someone who knows nomops.', to: '/community/hire-an-expert', icon: '🧑‍💻' },
      { title: 'Events', desc: 'Workshops, webinars and meetups.', to: '/community/events', icon: '📅' },
      { title: 'Support', desc: 'Community help and priority support.', to: '/community/support', icon: '🛟' },
    ],
  },
};
