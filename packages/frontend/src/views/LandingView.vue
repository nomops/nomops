<script setup lang="ts">
import { useRouter } from 'vue-router';
import boltUrl from '../assets/hero-lightning.webp';
import MarketingNav from '../components/marketing/MarketingNav.vue';
import MarketingFooter from '../components/marketing/MarketingFooter.vue';

/**
 * 公开落地页（对标 n8n.io 首页布局与视觉语言，品牌为 nomops，文案为诚实占位）。
 * 未登录访问 `/` 时由 RootView 渲染；登录后 RootView 渲染 Overview。
 * 深色单主题（与 n8n.io 一致）。导航/页脚复用 Marketing 组件，CTA 深链到营销页。
 */
const router = useRouter();
const go = (to: string) => router.push(to);
</script>

<template>
  <div class="landing">
    <!-- ── Nav (shared) ── -->
    <MarketingNav />

    <!-- ── Hero ── -->
    <section class="hero">
      <div class="wrap hero-grid">
        <div class="hero-copy">
          <h1>AI agents and workflows <span class="dim">you can see and control</span></h1>
          <p class="lead">Build visually, go deep with code, connect to anything. Every step of your agents' reasoning, traceable on the canvas. Deploy on your infrastructure or ours.</p>
          <div class="cta-row">
            <button class="btn btn-accent btn-lg" @click="go('/signup')">Get started for free</button>
            <button class="btn btn-ghost btn-lg" @click="go('/enterprise')">Talk to sales</button>
          </div>
        </div>
        <div class="bolt-wrap">
          <div class="bolt-glow" />
          <img class="bolt-img" :src="boltUrl" alt="" width="900" height="1359" loading="eager" />
        </div>
      </div>
    </section>

    <!-- ── Persona band ── -->
    <section class="persona">
      <div class="wrap">
        <p class="persona-intro"><b>Workflow automation built for technical teams</b>, including</p>
        <div class="persona-body">
          <div class="persona-tabs">
            <button class="p-tab active"><span class="role">IT Ops can</span><span class="task">On-board new employees</span></button>
            <button class="p-tab"><span class="role">Sec Ops can</span><span class="task">Enrich security incident tickets</span></button>
            <button class="p-tab"><span class="role">Dev Ops can</span><span class="task">Convert natural language into API calls</span></button>
            <button class="p-tab"><span class="role">Sales can</span><span class="task">Generate customer insights from reviews</span></button>
            <button class="p-tab"><span class="role">You can</span><span class="task">Build your first workflow in minutes</span></button>
          </div>
          <div class="canvas">
            <div class="node trigger">⚡<small>Form submission</small></div>
            <div class="conn" />
            <div class="node">🤖<small>AI Agent</small></div>
            <div class="conn" />
            <div class="node">🔀<small>If</small></div>
            <div class="conn" />
            <div class="node">💬<small>Add to channel</small></div>
          </div>
        </div>
        <div class="stats">
          <div class="stat">
            <span class="chip"><svg viewBox="0 0 24 24" fill="#ff8a4c"><circle cx="7" cy="12" r="2.4" /><circle cx="17" cy="7" r="2.4" /><circle cx="17" cy="17" r="2.4" /><path d="M9 11l6-3M9 13l6 3" stroke="#ff8a4c" stroke-width="1.4" /></svg></span>
            <span><b>Open source at the core.</b> Run the full platform on your own infrastructure, or let us host it.</span>
          </div>
          <div class="stat">
            <span class="chip"><svg viewBox="0 0 24 24" fill="none" stroke="#ff8a4c" stroke-width="1.9"><path d="M9 8l-4 4 4 4M15 8l4 4-4 4" /></svg></span>
            <span><b>Visual and code, together.</b> Drag out the flow, then drop into JavaScript or Python when you need to.</span>
          </div>
          <div class="stat">
            <span class="chip"><svg viewBox="0 0 24 24" fill="none" stroke="#ff8a4c" stroke-width="1.8"><circle cx="9" cy="8" r="3" /><circle cx="17" cy="10" r="2.4" /><path d="M3 20c0-3.3 2.7-5 6-5s6 1.7 6 5M15 20c0-2.4 1.6-4 3.5-4" /></svg></span>
            <span><b>Built for teams.</b> Projects, roles, credentials and audit logs come standard.</span>
          </div>
        </div>
      </div>
    </section>

    <!-- ── Integrations ── -->
    <section id="usecases" class="section-pad center">
      <div class="wrap">
        <h2 class="big">Plug AI into your own data &amp; <span class="b">hundreds of integrations</span></h2>
        <p class="sub">Use pre-built nodes for common apps. Custom API connections for everything else.</p>
        <div class="logos">
          <span class="logo-pill">💬</span><span class="logo-pill">📮</span><span class="logo-pill">🗄️</span>
          <span class="logo-pill">🤖</span><span class="logo-pill">📊</span><span class="logo-pill">🔔</span>
          <span class="logo-pill">📎</span><span class="logo-pill">🧠</span><span class="logo-pill">✉️</span>
          <span class="logo-pill">🗓️</span><span class="logo-pill">☁️</span><span class="logo-pill">🔗</span>
        </div>
        <button class="btn btn-violet btn-lg" @click="go('/product/integrations')">Browse all integrations</button>
      </div>
    </section>

    <!-- ── AI agents ── -->
    <section id="product" class="section-pad center">
      <div class="wrap">
        <h2 class="big"><span class="b">Build AI agents</span><br>you can actually follow</h2>
        <p class="sub">Connect any model. Inspect every decision. Keep humans in the loop.</p>
        <div class="cards-2 cards-left">
          <div class="fcard tall">
            <h3>Build complex AI without getting boxed in</h3>
            <p>Handle multi-agent setups and RAG systems. Use multiple cloud or offline AI models. Integrate with legacy systems while staying set up for the future with MCP support.</p>
            <button class="btn btn-violet card-btn" @click="go('/product/ai')">Explore AI</button>
          </div>
          <div class="fcard tall">
            <h3>Let people and logic guide AI decisions</h3>
            <p>Enforce structured inputs and outputs to control the data flow to and from AI steps. Combine human-in-the-loop approvals with rule-based automation to contain AI actions.</p>
            <ul class="checks push">
              <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M5 12l5 5L20 6" /></svg><span>Route decisions through approval steps</span></li>
              <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M5 12l5 5L20 6" /></svg><span>Create a task in your tracker automatically</span></li>
            </ul>
          </div>
          <div class="fcard tall">
            <h3>Runs where you decide</h3>
            <p>Protect your data by deploying on-prem.</p>
            <ul class="checks push">
              <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M5 12l5 5L20 6" /></svg><span><b>Deploy with Docker</b></span></li>
              <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M5 12l5 5L20 6" /></svg><span>Access the entire source code on GitHub</span></li>
              <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M5 12l5 5L20 6" /></svg><span>Hosted version also available</span></li>
            </ul>
          </div>
          <div class="fcard tall">
            <h3>Code when you need it, UI when you don't</h3>
            <p>Other tools limit you to either a visual building experience, or code. With nomops, you get the best of both worlds.</p>
            <ul class="checks push">
              <li><span class="code-tok">&lt;/&gt;</span><span>Write <b>JavaScript or Python</b> anywhere in your workflow.</span></li>
              <li><span class="code-tok">&lt;/&gt;</span><span>See inputs and outputs right next to every step.</span></li>
              <li><span class="code-tok">&lt;/&gt;</span><span>Test AI workflows with real data before customers do.</span></li>
            </ul>
          </div>
        </div>
      </div>
    </section>

    <!-- ── Move fast ── -->
    <section class="section-pad">
      <div class="wrap">
        <h2 class="big text-left"><span class="b">Move fast. Break nothing.</span></h2>
        <p class="sub sub-left">Build with the short feedback loops that keep you in the flow.</p>
        <ul class="checks two wide">
          <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M5 12l5 5L20 6" /></svg><span><b>Re-run single steps</b>, not your entire workflow</span></li>
          <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M5 12l5 5L20 6" /></svg><span><b>Replay or mock data</b> to not wait for external systems</span></li>
          <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M5 12l5 5L20 6" /></svg><span><b>Avoid endless debugging clicks</b> with the logs view</span></li>
          <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M5 12l5 5L20 6" /></svg><span><b>Evaluate AI natively</b> to optimize performance</span></li>
        </ul>
        <button class="btn btn-violet btn-lg mt-lg" @click="go('/product')">See full product overview</button>
      </div>
    </section>

    <!-- ── Case studies (illustrative) ── -->
    <section id="community" class="section-pad">
      <div class="wrap">
        <p class="eyebrow">Case studies</p>
        <div class="cs-cards">
          <div class="cs">
            <h3>Ship AI automation your whole team can audit</h3>
            <blockquote>"nomops lets us put AI into real processes in a controlled, reviewable way — not a black box. Every run is on the canvas, so anyone can follow what happened."</blockquote>
            <div class="who"><span class="n">Platform Engineering Lead</span><span class="t">Illustrative example</span></div>
            <button class="btn btn-violet card-btn" @click="go('/use-cases/case-studies')">Read case study</button>
          </div>
          <div class="cs">
            <h3>From a graveyard of scripts to production workflows</h3>
            <blockquote>"The brittle cron scripts nobody wanted to touch are now workflows we can watch, replay and hand off. Onboarding a new engineer takes an afternoon."</blockquote>
            <div class="who"><span class="n">Head of DevOps</span><span class="t">Illustrative example</span></div>
            <button class="btn btn-violet card-btn" @click="go('/use-cases/case-studies')">Read case study</button>
          </div>
        </div>
      </div>
    </section>

    <!-- ── Enterprise ── -->
    <section id="enterprise" class="section-pad">
      <div class="wrap">
        <p class="eyebrow"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M13 2 4.5 13.5H11l-1 8.5 8.5-11.5H12l1-8.5z" /></svg> Enterprise-ready</p>
        <h2 class="big text-left mt-md"><span class="b">Reliable. Scalable. Secure.</span></h2>
        <p class="sub sub-left">Deploy on your infra or ours. Push workflows to production with the DevOps experience teams trust. nomops's security and governance features let you build, monitor, and scale agents without losing control.</p>
        <div class="ent-cols">
          <div class="ent-col"><div class="ic">🔒</div><h4>Security and control</h4><p>Fully on-prem option, SSO SAML and LDAP, encrypted secret stores, version control, RBAC permissions.</p></div>
          <div class="ent-col"><div class="ic">📈</div><h4>Observability and transparency</h4><p>Audit logs and log streaming to your SIEM, workflow history, real-time alerts, usage dashboards.</p></div>
          <div class="ent-col"><div class="ic">🧑‍💻</div><h4>Developer experience</h4><p>Git-based control, isolated environments, multi-user workflows, workflow diffs.</p></div>
          <div class="ent-col"><div class="ic">🛡️</div><h4>AI governance</h4><p>Human-in-the-loop, guardrails, evaluations.</p></div>
        </div>
        <div class="cta-row mt-lg">
          <button class="btn btn-accent btn-lg" @click="go('/enterprise')">Explore nomops for enterprise</button>
          <button class="btn btn-ghost btn-lg" @click="go('/community/support')">Talk to sales</button>
        </div>
      </div>
    </section>

    <!-- ── Testimonials (illustrative) ── -->
    <section class="section-pad testi">
      <div class="twrap">
        <div class="track">
          <div class="tweet"><p>Self-hosting plus low-code makes nomops a dev's dream. If you're not automating yet, you're working too hard.</p><div class="who"><span class="av" /><span><span class="n">Dana R.</span><br><span class="h">@dana_builds</span></span></div></div>
          <div class="tweet"><p>Did the intro tutorial and immediately shipped something way beyond my skill level.</p><div class="who"><span class="av" /><span><span class="n">Marco T.</span><br><span class="h">@marcoships</span></span></div></div>
          <div class="tweet"><p>Anything is possible with nomops — you just need a bit of technical knowledge and some imagination.</p><div class="who"><span class="av" /><span><span class="n">Priya N.</span><br><span class="h">@priya_flows</span></span></div></div>
          <div class="tweet"><p>I was skeptical of no-code tools. nomops changed my mind — built a Slack agent in half an hour.</p><div class="who"><span class="av" /><span><span class="n">Leo F.</span><br><span class="h">@leo_automates</span></span></div></div>
          <div class="tweet"><p>Self-hosting plus low-code makes nomops a dev's dream. If you're not automating yet, you're working too hard.</p><div class="who"><span class="av" /><span><span class="n">Dana R.</span><br><span class="h">@dana_builds</span></span></div></div>
          <div class="tweet"><p>Did the intro tutorial and immediately shipped something way beyond my skill level.</p><div class="who"><span class="av" /><span><span class="n">Marco T.</span><br><span class="h">@marcoships</span></span></div></div>
        </div>
      </div>
    </section>

    <!-- ── Final CTA ── -->
    <section id="pricing" class="final">
      <div class="wrap">
        <h2 class="big center"><span class="b">Simple enough to see.</span><br>Powerful enough to ship.</h2>
        <p class="sub">Join the teams building AI automation they can actually explain.</p>
        <button class="btn btn-accent btn-lg mt-lg" @click="go('/signup')">Start building</button>
      </div>
    </section>

    <!-- ── Footer (shared) ── -->
    <MarketingFooter />
  </div>
</template>

<style scoped>
.landing {
  /* 落地页专属令牌（不污染 app 全局 style.css） */
  --l-bg: #0c0c11;
  --l-bg2: #101017;
  --l-panel: #16161f;
  --l-panel2: #1b1b26;
  --l-border: rgba(255, 255, 255, 0.08);
  --l-border2: rgba(255, 255, 255, 0.13);
  --l-text: #ededf2;
  --l-dim: #9a9aa7;
  --l-faint: #6b6b78;
  --l-head: #c9c9d4;
  --l-accent-grad: linear-gradient(135deg, #ff8a4c 0%, #ee4620 100%);
  --l-violet-grad: linear-gradient(135deg, #7161ff 0%, #5a86ff 100%);
  --l-maxw: 1180px;

  /* #app 是 100vh 的 flex column，落地页作为其 flex 子项自行内部滚动（与 app 外壳一致） */
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  background: var(--l-bg);
  color: var(--l-text);
  font-family: system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  line-height: 1.5;
}
.landing a { color: inherit; text-decoration: none; cursor: pointer; }

.wrap { max-width: var(--l-maxw); margin: 0 auto; padding: 0 24px; }

/* 导航/页脚已抽到 components/marketing 的共享组件；此处只留正文样式 */
.btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; height: 38px; padding: 0 18px; border-radius: 10px; font-size: 14.5px; font-weight: 600; border: none; cursor: pointer; font-family: inherit; color: #fff; white-space: nowrap; transition: transform .12s, filter .15s, background .15s; }
.btn:hover { transform: translateY(-1px); }
.btn:focus-visible { outline: 2px solid #ff8a4c; outline-offset: 2px; }
.btn-accent { background: var(--l-accent-grad); box-shadow: 0 6px 20px rgba(238, 70, 32, 0.35); }
.btn-accent:hover { filter: brightness(1.06); }
.btn-violet { background: var(--l-violet-grad); box-shadow: 0 6px 20px rgba(90, 110, 255, 0.3); }
.btn-ghost { background: rgba(255, 255, 255, 0.05); border: 1px solid var(--l-border2); color: var(--l-text); }
.btn-ghost:hover { background: rgba(255, 255, 255, 0.09); }
.btn-lg { height: 48px; padding: 0 26px; font-size: 16px; border-radius: 12px; }

/* Hero */
.hero { position: relative; padding: 84px 0 40px; overflow: hidden; }
.hero-grid { display: grid; grid-template-columns: 1.05fr 0.95fr; align-items: center; gap: 20px; }
.hero h1 { margin: 0; font-size: clamp(40px, 6.2vw, 74px); line-height: 1.03; font-weight: 700; letter-spacing: -0.025em; text-wrap: balance; color: #fff; }
.hero h1 .dim { color: #7d7d8c; }
.lead { margin: 26px 0 0; max-width: 30em; font-size: 18px; color: var(--l-dim); line-height: 1.6; }
.cta-row { display: flex; gap: 14px; margin-top: 34px; flex-wrap: wrap; }

.bolt-wrap { position: relative; height: 520px; display: flex; align-items: center; justify-content: center; }
.bolt-glow { position: absolute; width: 460px; height: 460px; border-radius: 50%; background: radial-gradient(circle, rgba(255, 120, 50, 0.42) 0%, rgba(238, 70, 32, 0.14) 40%, transparent 68%); filter: blur(20px); animation: l-pulse 5s ease-in-out infinite; }
@keyframes l-pulse { 0%, 100% { opacity: .75; transform: scale(1); } 50% { opacity: 1; transform: scale(1.06); } }
/* 真实闪电照片：暖色调滤镜(蓝→橙)贴合主题 + 径向遮罩融入深色底 */
.bolt-img {
  position: relative;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: 42% center;
  filter: sepia(0.78) saturate(2.8) hue-rotate(-12deg) brightness(1.05) contrast(1.12);
  -webkit-mask-image: radial-gradient(105% 96% at 50% 45%, #000 34%, rgba(0, 0, 0, 0.55) 64%, transparent 82%);
  mask-image: radial-gradient(105% 96% at 50% 45%, #000 34%, rgba(0, 0, 0, 0.55) 64%, transparent 82%);
}

/* Persona band */
.persona { padding: 40px 0 30px; }
.persona-intro { color: var(--l-dim); font-size: 17px; max-width: 42em; margin: 0 0 26px; }
.persona-intro b { color: var(--l-text); font-weight: 600; }
.persona-body { display: grid; grid-template-columns: 300px 1fr; gap: 30px; align-items: start; }
.persona-tabs { display: flex; flex-direction: column; }
.p-tab { text-align: left; background: none; border: none; border-left: 2px solid var(--l-border); padding: 16px 18px; cursor: pointer; font-family: inherit; color: var(--l-faint); transition: color .15s, border-color .15s, background .15s; }
.p-tab .role { display: block; font-size: 17px; font-weight: 600; color: var(--l-dim); }
.p-tab .task { display: block; font-size: 14px; margin-top: 3px; }
.p-tab.active { border-left-color: #ee4620; background: linear-gradient(90deg, rgba(238, 70, 32, 0.08), transparent); }
.p-tab.active .role { color: #fff; }
.p-tab.active .task { color: var(--l-dim); }

.canvas { position: relative; min-height: 300px; border: 1px solid var(--l-border); border-radius: 16px; background: radial-gradient(circle at 1px 1px, rgba(255, 255, 255, 0.06) 1px, transparent 0) 0 0 / 22px 22px, var(--l-bg2); padding: 30px; display: flex; align-items: center; justify-content: center; gap: 46px; flex-wrap: wrap; }
.node { position: relative; width: 92px; height: 76px; border-radius: 12px; background: var(--l-panel2); border: 1px solid var(--l-border2); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; font-size: 22px; }
.node small { position: absolute; top: calc(100% + 7px); white-space: nowrap; font-size: 11.5px; color: var(--l-faint); }
.node.trigger { border-left: 3px solid #ee4620; }
.conn { width: 46px; height: 2px; background: linear-gradient(90deg, var(--l-border2), var(--l-faint)); position: relative; }
.conn::after { content: ''; position: absolute; right: -1px; top: -3px; border: 4px solid transparent; border-left-color: var(--l-faint); }

/* Stat cards */
.stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; padding: 30px 0 60px; }
.stat { display: flex; gap: 14px; padding: 22px; border-radius: 14px; border: 1px solid var(--l-border); background: linear-gradient(180deg, var(--l-panel), rgba(22, 22, 31, 0.5)); font-size: 15px; color: var(--l-dim); line-height: 1.5; }
.stat b { color: var(--l-text); font-weight: 600; }
.stat .chip { width: 42px; height: 42px; flex-shrink: 0; border-radius: 10px; background: rgba(255, 255, 255, 0.05); border: 1px solid var(--l-border); display: flex; align-items: center; justify-content: center; }
.stat .chip svg { width: 22px; height: 22px; }

/* Sections */
.section-pad { padding: 80px 0; }
.center { text-align: center; }
.text-left { text-align: left; }
h2.big { margin: 0; font-size: clamp(32px, 4.6vw, 58px); font-weight: 500; line-height: 1.08; letter-spacing: -0.015em; color: var(--l-head); text-wrap: balance; }
h2.big .b { color: #fff; }
.sub { margin: 18px auto 0; font-size: 18px; color: var(--l-dim); max-width: 40em; }
.center .sub { text-align: center; }
.sub-left { margin-left: 0; text-align: left; }
.mt-md { margin-top: 20px; }
.mt-lg { margin-top: 32px; }

.eyebrow { display: inline-flex; align-items: center; gap: 7px; padding: 7px 14px; border-radius: 999px; background: rgba(255, 255, 255, 0.05); border: 1px solid var(--l-border2); font-size: 13.5px; color: var(--l-text); }
.eyebrow svg { width: 14px; height: 14px; color: #ff8a4c; flex-shrink: 0; }

.cards-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 48px; }
.cards-left { text-align: left; }
.fcard { border: 1px solid var(--l-border); border-radius: 18px; background: var(--l-panel); padding: 34px; overflow: hidden; }
.fcard h3 { margin: 0 0 12px; font-size: 24px; font-weight: 600; color: #fff; letter-spacing: -0.01em; }
.fcard p { margin: 0; color: var(--l-dim); font-size: 15.5px; line-height: 1.6; }
.fcard.tall { min-height: 300px; display: flex; flex-direction: column; }
.card-btn { align-self: flex-start; margin-top: auto; }
.checks { list-style: none; margin: 20px 0 0; padding: 0; display: grid; gap: 14px; }
.checks.push { margin-top: auto; padding-top: 20px; }
.checks.two { grid-template-columns: 1fr 1fr; }
.checks.wide { margin-top: 34px; max-width: 760px; }
.checks li { display: flex; gap: 10px; font-size: 15px; color: var(--l-dim); line-height: 1.45; }
.checks li b { color: var(--l-text); font-weight: 600; }
.checks svg { width: 18px; height: 18px; flex-shrink: 0; color: #64c98a; margin-top: 1px; }
.code-tok { color: #7d97ff; font-family: ui-monospace, Menlo, monospace; font-size: 13px; margin-top: 2px; flex-shrink: 0; }

/* Case studies */
.cs-cards { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 44px; }
.cs { border: 1px solid var(--l-border); border-radius: 18px; padding: 34px; background: linear-gradient(160deg, var(--l-panel2), var(--l-panel)); display: flex; flex-direction: column; gap: 18px; }
.cs h3 { margin: 0; font-size: 22px; font-weight: 600; color: #fff; line-height: 1.25; }
.cs blockquote { margin: 0; color: var(--l-dim); font-size: 15.5px; line-height: 1.6; font-style: italic; }
.cs .who { display: flex; flex-direction: column; margin-top: auto; }
.cs .who .n { color: var(--l-text); font-weight: 600; font-size: 14.5px; }
.cs .who .t { color: var(--l-faint); font-size: 13px; }

/* Enterprise */
.ent-cols { display: grid; grid-template-columns: repeat(4, 1fr); gap: 22px; margin-top: 50px; }
.ent-col h4 { margin: 0 0 10px; font-size: 16px; font-weight: 600; color: #fff; }
.ent-col p { margin: 0; font-size: 14px; color: var(--l-dim); line-height: 1.55; }
.ent-col .ic { width: 40px; height: 40px; border-radius: 10px; background: rgba(255, 255, 255, 0.05); border: 1px solid var(--l-border); display: flex; align-items: center; justify-content: center; margin-bottom: 14px; font-size: 19px; }

/* Testimonials */
.twrap { overflow: hidden; padding: 20px 0 0; -webkit-mask-image: linear-gradient(90deg, transparent, #000 6%, #000 94%, transparent); mask-image: linear-gradient(90deg, transparent, #000 6%, #000 94%, transparent); }
.track { display: flex; gap: 20px; width: max-content; animation: l-marquee 44s linear infinite; }
@keyframes l-marquee { to { transform: translateX(-50%); } }
.tweet { width: 380px; border: 1px solid var(--l-border); border-radius: 16px; background: var(--l-panel); padding: 26px; display: flex; flex-direction: column; gap: 22px; }
.tweet p { margin: 0; font-size: 15px; color: var(--l-dim); line-height: 1.55; }
.tweet .who { display: flex; align-items: center; gap: 12px; margin-top: auto; }
.tweet .av { width: 40px; height: 40px; border-radius: 50%; background: linear-gradient(135deg, #5a86ff, #7161ff); flex-shrink: 0; }
.tweet .n { color: var(--l-text); font-weight: 600; font-size: 14px; }
.tweet .h { color: var(--l-faint); font-size: 12.5px; }

/* Final CTA */
.final { position: relative; text-align: center; padding: 120px 0 90px; overflow: hidden; }
.final::before { content: ''; position: absolute; inset: 0; z-index: 0; background: radial-gradient(120% 90% at 50% 130%, rgba(255, 120, 50, 0.55) 0%, rgba(238, 70, 32, 0.22) 32%, transparent 60%); }
.final .wrap { position: relative; z-index: 1; }
.final h2 { color: #f3f3f6; }
.final h2 .b { color: #fff; }

@media (prefers-reduced-motion: reduce) {
  .track, .bolt-glow { animation: none; }
  .btn:hover { transform: none; }
}

@media (max-width: 900px) {
  .hero-grid, .persona-body, .stats, .cards-2, .cs-cards { grid-template-columns: 1fr; }
  .bolt-wrap { height: 340px; }
  .ent-cols { grid-template-columns: 1fr 1fr; }
}
</style>
