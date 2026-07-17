<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api/client.js';
import { useAuthStore } from '../stores/auth.js';

/**
 * 注册页。两种模式：
 * - 普通注册（首个用户 = owner）；owner 建成后公开注册关闭，后端回 403。
 * - 邀请接受（URL 带 ?invite=<token>）：预填邮箱、只设口令；成功即登录 → Overview。
 */
const auth = useAuthStore();
const router = useRouter();
const route = useRoute();

const email = ref('');
const password = ref('');
const error = ref('');
const busy = ref(false);

const inviteToken = ref(String(route.query['invite'] ?? ''));
const isInvite = ref(!!inviteToken.value);

onMounted(async () => {
  if (!inviteToken.value) return;
  try {
    const info = await api.lookupInvite(inviteToken.value);
    email.value = info.email; // 预填、只读
  } catch {
    error.value = 'This invitation is invalid or has already been used.';
    isInvite.value = false;
    inviteToken.value = '';
  }
});

async function submit() {
  error.value = '';
  busy.value = true;
  try {
    if (inviteToken.value) {
      await auth.acceptInvite(inviteToken.value, password.value);
    } else {
      await auth.register(email.value, password.value);
    }
    void router.push({ name: 'overview' });
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="signup">
    <div class="su-topbar">
      <RouterLink to="/" class="brand">
        <svg class="mark" viewBox="19 37 130 54" fill="none"><defs><linearGradient id="nomops-mark-auth" gradientUnits="userSpaceOnUse" x1="23" y1="64" x2="145" y2="64"><stop offset="0" stop-color="#22d3ee" /><stop offset="0.5" stop-color="#6366f1" /><stop offset="1" stop-color="#a855f7" /></linearGradient></defs><path d="M57 64C73.2 90 75.4 90 84 64C92.6 38 94.8 38 111 64" stroke="url(#nomops-mark-auth)" stroke-width="6.5" stroke-linecap="round" /><circle cx="40" cy="64" r="17" fill="url(#nomops-mark-auth)" /><circle cx="128" cy="64" r="17" fill="url(#nomops-mark-auth)" /></svg>
        nomops
      </RouterLink>
      <span class="su-right">Already have an account? <RouterLink to="/login">Sign in</RouterLink></span>
    </div>

    <div class="su-body">
      <div class="su-left">
        <h1>Start automating<br><span class="dim">in minutes</span></h1>
        <p class="su-lead">Create a free account and build your first workflow on the canvas. No credit card required.</p>
        <ul class="su-checks">
          <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M5 12l5 5L20 6" /></svg><span>Visual editor with code when you need it</span></li>
          <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M5 12l5 5L20 6" /></svg><span>Hundreds of integrations out of the box</span></li>
          <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M5 12l5 5L20 6" /></svg><span>Self-host anytime — full source access</span></li>
        </ul>
      </div>

      <form class="su-card" @submit.prevent="submit">
        <h2>{{ isInvite ? 'Accept your invitation' : 'Create your account' }}</h2>
        <label>Email</label>
        <input v-model="email" data-test="signup-email" type="email" required placeholder="you@example.com" :readonly="isInvite" />
        <label>Password</label>
        <input v-model="password" data-test="signup-password" type="password" required minlength="8" placeholder="At least 8 characters" />

        <p v-if="error" class="su-error" data-test="signup-error">{{ error }}</p>

        <button class="mkt-btn mkt-btn-accent su-submit" data-test="signup-submit" type="submit" :disabled="busy">
          {{ busy ? (isInvite ? 'Joining…' : 'Creating account…') : (isInvite ? 'Join instance' : 'Create account') }}
        </button>

        <p class="su-fine">By continuing you agree to the <a href="/docs/terms" target="_blank" rel="noopener">Terms of Service</a> and <a href="/docs/privacy" target="_blank" rel="noopener">Privacy Policy</a>.</p>
      </form>
    </div>
  </div>
</template>

<style scoped>
.signup {
  flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden;
  background:
    radial-gradient(90% 60% at 85% 0%, rgba(238, 70, 32, 0.16), transparent 55%),
    var(--mkt-bg);
  color: var(--mkt-text); font-family: var(--mkt-font); -webkit-font-smoothing: antialiased;
}
.su-topbar { display: flex; align-items: center; justify-content: space-between; padding: 22px 32px; }
.brand { display: inline-flex; align-items: center; gap: 9px; font-weight: 700; font-size: 20px; color: var(--mkt-text); }
.brand .mark { width: 46px; height: 26px; }
.su-right { color: var(--mkt-dim); font-size: 13.5px; }
.su-right a { color: var(--mkt-text); text-decoration: underline; margin-left: 4px; }

.su-body {
  max-width: 1040px; margin: 0 auto; padding: 6vh 32px 60px;
  display: grid; grid-template-columns: 1fr 440px; gap: 60px; align-items: center;
}
.su-left h1 { margin: 0; font-size: clamp(34px, 4.4vw, 52px); font-weight: 700; line-height: 1.05; letter-spacing: -0.025em; color: #fff; }
.su-left h1 .dim { color: #7d7d8c; }
.su-lead { margin: 20px 0 0; font-size: 17px; color: var(--mkt-dim); line-height: 1.6; max-width: 30em; }
.su-checks { list-style: none; margin: 26px 0 0; padding: 0; display: grid; gap: 13px; }
.su-checks li { display: flex; gap: 10px; font-size: 15px; color: var(--mkt-dim); }
.su-checks svg { width: 18px; height: 18px; flex-shrink: 0; color: #64c98a; }

.su-card { background: var(--mkt-panel); border: 1px solid var(--mkt-border2); border-radius: 16px; padding: 30px; box-shadow: 0 20px 60px rgba(0, 0, 0, 0.45); display: flex; flex-direction: column; }
.su-card h2 { margin: 0 0 18px; font-size: 20px; font-weight: 600; color: #fff; }
.su-card label { margin: 14px 0 6px; color: var(--mkt-text); font-size: 13px; }
.su-card input {
  height: 42px; padding: 0 13px; background: var(--mkt-bg2); border: 1px solid var(--mkt-border);
  border-radius: 8px; color: var(--mkt-text); font-size: 14.5px; font-family: inherit;
}
.su-card input:focus { outline: none; border-color: var(--mkt-accent-hi); }
.su-submit { width: 100%; margin-top: 20px; }
.su-submit:disabled { opacity: 0.6; cursor: not-allowed; }
.su-error { color: #ef6f6c; font-size: 13px; margin: 12px 0 0; }
.su-fine { font-size: 11.5px; color: var(--mkt-faint); text-align: center; margin: 16px 0 0; }
.su-fine a { color: var(--mkt-faint); text-decoration: underline; }

@media (max-width: 860px) {
  .su-body { grid-template-columns: 1fr; gap: 34px; padding-top: 3vh; }
  .su-left { display: none; }
}
</style>
