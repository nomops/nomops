<script setup lang="ts">
/** 营销站页脚（对标 n8n.io，品牌 nomops，内部链接走营销路由）。 */
</script>

<template>
  <footer class="footer">
    <div class="foot">
      <div class="foot-top">
        <div>
          <RouterLink to="/" class="brand">
            <svg class="mark" viewBox="0 0 32 32" fill="none"><circle cx="7" cy="16" r="3" fill="#ff8a4c" /><circle cx="16" cy="9" r="3" fill="#ee4620" /><circle cx="16" cy="23" r="3" fill="#ee4620" /><circle cx="25" cy="16" r="3.4" fill="#ff8a4c" /><path d="M9.5 15 13.5 10.5M9.5 17 13.5 21.5M18.5 9.5 22.5 15M18.5 22.5 22.5 17" stroke="#7d7d8c" stroke-width="1.4" /></svg>
            nomops
          </RouterLink>
          <p class="tag">Automate without limits</p>
          <div class="socials">
            <a href="#twitter" aria-label="Twitter"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M22 5.9c-.7.3-1.5.5-2.3.6.8-.5 1.5-1.3 1.8-2.3-.8.5-1.7.8-2.6 1a4 4 0 0 0-6.9 3.7A11.4 11.4 0 0 1 3.6 4.8a4 4 0 0 0 1.2 5.4c-.6 0-1.2-.2-1.8-.5v.1a4 4 0 0 0 3.2 4 4 4 0 0 1-1.8.1 4 4 0 0 0 3.7 2.8A8 8 0 0 1 2 18.6a11.3 11.3 0 0 0 6.1 1.8c7.4 0 11.5-6.2 11.5-11.5v-.5c.8-.6 1.5-1.3 2-2.1z" /></svg></a>
            <a href="#github" aria-label="GitHub"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.5 2 2 6.6 2 12.3c0 4.5 2.9 8.3 6.8 9.7.5.1.7-.2.7-.5v-1.7c-2.8.6-3.4-1.4-3.4-1.4-.5-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.6 2.4 1.1 3 .8.1-.7.3-1.1.6-1.4-2.2-.3-4.6-1.1-4.6-5 0-1.1.4-2 1-2.7-.1-.3-.4-1.3.1-2.7 0 0 .8-.3 2.7 1a9.3 9.3 0 0 1 5 0c1.9-1.3 2.7-1 2.7-1 .5 1.4.2 2.4.1 2.7.6.7 1 1.6 1 2.7 0 3.9-2.4 4.7-4.6 5 .3.3.7 1 .7 2v3c0 .3.2.6.7.5A10.3 10.3 0 0 0 22 12.3C22 6.6 17.5 2 12 2Z" /></svg></a>
            <a href="#discord" aria-label="Discord"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zM9 17H6.5v-6H9v6zM7.7 9.7a1.4 1.4 0 1 1 0-2.8 1.4 1.4 0 0 1 0 2.8zM18 17h-2.5v-3.2c0-.9-.4-1.4-1.1-1.4-.6 0-1 .4-1.1 1v3.6H10.8v-6h2.4v1c.3-.6 1-1.1 2-1.1 1.6 0 2.8 1 2.8 3.2V17z" /></svg></a>
          </div>
        </div>
        <div class="foot-col">
          <span class="foot-h">Product</span>
          <RouterLink to="/product">Overview</RouterLink>
          <RouterLink to="/product/integrations">Integrations</RouterLink>
          <RouterLink to="/product/templates">Templates</RouterLink>
          <RouterLink to="/product/ai">AI</RouterLink>
          <RouterLink to="/pricing">Pricing</RouterLink>
        </div>
        <div class="foot-col">
          <span class="foot-h">Resources</span>
          <RouterLink to="/docs">Docs</RouterLink>
          <RouterLink to="/docs/self-host">Self-host</RouterLink>
          <RouterLink to="/use-cases">Use cases</RouterLink>
          <RouterLink to="/use-cases/case-studies">Case studies</RouterLink>
          <RouterLink to="/docs/release-notes">Release notes</RouterLink>
        </div>
        <div class="foot-col">
          <span class="foot-h">Company</span>
          <RouterLink to="/enterprise">Enterprise</RouterLink>
          <RouterLink to="/community">Community</RouterLink>
          <RouterLink to="/community/careers">Careers <span class="hbadge">Hiring</span></RouterLink>
          <RouterLink to="/community/partners">Partners</RouterLink>
          <RouterLink to="/community/support">Support</RouterLink>
        </div>
      </div>
      <div class="foot-bar">
        <div class="links">
          <a href="#imprint">Imprint</a><a href="#security">Security</a><a href="#privacy">Privacy</a><a href="#report">Report a vulnerability</a>
        </div>
        <span>© 2026 nomops · All rights reserved.</span>
      </div>
    </div>
  </footer>
</template>

<style scoped>
.footer { padding: 0 20px 40px; }
.foot {
  max-width: var(--mkt-maxw); margin: 0 auto; border-radius: 22px; padding: 48px 44px 28px;
  background: linear-gradient(180deg, rgba(238, 70, 32, 0.13), rgba(20, 20, 28, 0.6) 42%);
  border: 1px solid var(--mkt-border);
}
.foot-top { display: grid; grid-template-columns: 1.5fr 1fr 1fr 1fr; gap: 30px; }
.brand { display: inline-flex; align-items: center; gap: 9px; font-weight: 700; font-size: 20px; color: var(--mkt-text); }
.brand .mark { width: 28px; height: 28px; }
.tag { color: var(--mkt-text); font-size: 15px; margin: 16px 0 20px; opacity: .85; }
.socials { display: flex; gap: 16px; color: var(--mkt-dim); }
.socials svg { width: 20px; height: 20px; flex-shrink: 0; }
.socials a:hover { color: var(--mkt-text); }
.foot-col { display: flex; flex-direction: column; gap: 12px; font-size: 14.5px; color: var(--mkt-dim); }
.foot-h { color: var(--mkt-text); font-weight: 600; font-size: 13px; text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 2px; }
.foot-col a:hover { color: var(--mkt-text); }
.hbadge { display: inline-flex; margin-left: 6px; padding: 2px 8px; border-radius: 999px; background: rgba(255, 255, 255, 0.1); font-size: 11px; color: var(--mkt-text); vertical-align: middle; }
.foot-bar { display: flex; justify-content: space-between; align-items: center; margin-top: 34px; padding-top: 20px; border-top: 1px solid var(--mkt-border); font-size: 13px; color: var(--mkt-faint); }
.foot-bar .links { display: flex; gap: 20px; flex-wrap: wrap; }
.foot-bar a:hover { color: var(--mkt-dim); }

@media (max-width: 900px) {
  .foot-top { grid-template-columns: 1fr 1fr; }
  .foot-bar { flex-direction: column; gap: 14px; align-items: flex-start; }
}
</style>
