<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth.js';

const auth = useAuthStore();
const router = useRouter();

const mode = ref<'login' | 'register'>('login');
const email = ref('');
const password = ref('');
const error = ref('');
const busy = ref(false);
const ssoEnabled = ref(false);
const ldapEnabled = ref(false);
const ldapMode = ref(false); // true = 用 LDAP 用户名/密码登录

onMounted(async () => {
  try {
    const status = await (await fetch('/sso/status')).json();
    ssoEnabled.value = Boolean(status.enabled);
  } catch {
    ssoEnabled.value = false;
  }
  try {
    const status = await (await fetch('/auth/ldap/status')).json();
    ldapEnabled.value = Boolean(status.enabled);
  } catch {
    ldapEnabled.value = false;
  }
});

const heading = computed(() => (mode.value === 'login' ? 'Log in to your instance' : 'Start automating'));

async function submit() {
  error.value = '';
  busy.value = true;
  try {
    if (ldapMode.value) {
      await auth.ldapLogin(email.value, password.value);
    } else if (mode.value === 'login') {
      await auth.login(email.value, password.value);
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
  <div class="auth-page">
    <div class="auth-topbar">
      <span class="brand">nomops</span>
      <span class="topbar-right">
        {{ mode === 'login' ? "Don't have an account?" : 'Already have an account?' }}
        <a href="#" data-test="toggle-mode" @click.prevent="mode = mode === 'login' ? 'register' : 'login'">
          {{ mode === 'login' ? 'Sign up' : 'Log in' }}
        </a>
      </span>
    </div>

    <div class="auth-body">
      <h1 class="auth-heading">{{ heading }}</h1>

      <form class="auth-card" @submit.prevent="submit">
        <template v-if="ldapMode">
          <label>LDAP username</label>
          <input v-model="email" data-test="ldap-username" type="text" required placeholder="Domain account (e.g. alice)" />
        </template>
        <template v-else>
          <label>Email</label>
          <input v-model="email" data-test="email" type="email" required placeholder="you@example.com" />
        </template>
        <label>Password</label>
        <input
          v-model="password"
          data-test="password"
          type="password"
          required
          :minlength="ldapMode ? 1 : 8"
          :placeholder="ldapMode ? 'LDAP password' : 'At least 8 characters'"
        />

        <p v-if="error" class="error-text" data-test="auth-error">{{ error }}</p>

        <button class="primary auth-submit" data-test="submit" type="submit" :disabled="busy" style="margin-top: 16px">
          {{ busy ? 'Working…' : ldapMode ? 'Log in with LDAP' : mode === 'login' ? 'Log in' : 'Create account' }}
        </button>

        <a v-if="ssoEnabled && !ldapMode" class="sso-btn" href="/sso/login" data-test="sso-login">Sign in with SSO</a>
        <a
          v-if="ldapEnabled"
          href="#"
          class="sso-btn"
          data-test="ldap-toggle"
          @click.prevent="ldapMode = !ldapMode; error = ''"
        >
          {{ ldapMode ? '← Use email & password' : 'Log in with LDAP' }}
        </a>

        <p class="fineprint">
          By continuing you agree to the
          <a href="/docs/terms" target="_blank" rel="noopener">Terms of Service</a> and
          <a href="/docs/privacy" target="_blank" rel="noopener">Privacy Policy</a>.
        </p>
      </form>

      <p class="self-host-note">
        Self-hosting? Spin up nomops Community with <code>docker compose up</code>.
      </p>
    </div>
  </div>
</template>

<style scoped>
.auth-page {
  flex: 1;
  min-height: 100vh;
  background: var(--auth-bg);
  display: flex;
  flex-direction: column;
}
.auth-topbar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 22px 28px;
}
.auth-topbar .brand { color: var(--accent); font-weight: 700; font-size: 20px; }
.topbar-right { color: var(--text-dim); font-size: 13px; }
.topbar-right a { color: var(--text); text-decoration: underline; margin-left: 4px; }

.auth-body { flex: 1; display: flex; flex-direction: column; align-items: center; padding-top: 9vh; }
.auth-heading {
  font-size: 30px; font-weight: 600; color: var(--text-hi); letter-spacing: -0.4px;
  margin: 0 0 28px; text-align: center;
}
.auth-card {
  width: 420px; max-width: 92vw;
  background: var(--auth-card);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 26px 28px 22px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
}
.auth-card label { margin: 14px 0 6px; color: var(--text); font-size: 13px; }
.auth-card label:first-child { margin-top: 0; }
.auth-card input { background: var(--bg); border-color: var(--border); padding: 11px 12px; }
.auth-card input:focus { border-color: var(--accent); }
.auth-submit { width: 100%; padding: 11px 16px; font-size: 14px; font-weight: 500; }
.sso-btn {
  display: block; text-align: center; margin-top: 10px;
  padding: 10px; border: 1px solid var(--border); border-radius: var(--radius);
  color: var(--text); text-decoration: none; font-size: 13px;
}
.sso-btn:hover { border-color: var(--accent); }
.fineprint { font-size: 11.5px; color: var(--text-dim); text-align: center; margin: 14px 0 0; }
.fineprint a { color: var(--text-dim); text-decoration: underline; }
.self-host-note { color: var(--text-dim); font-size: 13px; margin-top: 22px; }
.self-host-note code { background: var(--bg-input); padding: 2px 6px; border-radius: 4px; }
</style>
