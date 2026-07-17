<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api/client.js';
import { useAuthStore } from '../stores/auth.js';

/**
 * 认证页（对标 n8n 自托管）：
 * - 首访无用户 → 自动切「Set up owner account」（对应 n8n /setup；后端注册本就只放行首个用户）
 * - 已有用户 → Sign in；后续用户走邀请（SignupView）
 */
const auth = useAuthStore();
const router = useRouter();
const route = useRoute();

const mode = ref<'login' | 'setup' | 'forgot'>('login');
const email = ref('');
const password = ref('');
const firstName = ref('');
const lastName = ref('');
const wantUpdates = ref(false); // 仅 UI 对齐；自托管实例不外发任何数据
const error = ref('');
const busy = ref(false);
const ssoEnabled = ref(false);
const ldapEnabled = ref(false);
const ldapMode = ref(false); // true = 用 LDAP 用户名/密码登录
const mfaRequired = ref(false); // 口令通过后进入二因素输入
const mfaCode = ref('');
// 忘记密码 / 重置
const resetToken = ref<string | null>(null); // URL 带 ?reset= 时进入重置落地
const forgotSent = ref(false);
const resetDone = ref(false); // 重置成功后在登录页提示
const resetPass = ref('');
const resetPass2 = ref('');

onMounted(async () => {
  const rt = route.query['reset'];
  if (typeof rt === 'string' && rt) resetToken.value = rt;
  try {
    if ((await api.needsSetup()).needsSetup) mode.value = 'setup';
  } catch {
    /* 保持 login */
  }
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

async function submit() {
  error.value = '';
  if (mode.value === 'setup' && !/^(?=.*\d)(?=.*[A-Z]).{8,}$/.test(password.value)) {
    error.value = '8+ characters, at least 1 number and 1 capital letter';
    return;
  }
  busy.value = true;
  try {
    if (ldapMode.value) {
      await auth.ldapLogin(email.value, password.value);
    } else if (mode.value === 'login') {
      const res = await auth.login(email.value, password.value, mfaRequired.value ? mfaCode.value : undefined);
      if (res.mfaRequired) {
        // 口令通过，进入二因素输入（不跳转）
        mfaRequired.value = true;
        busy.value = false;
        return;
      }
    } else {
      await auth.register(email.value, password.value, firstName.value.trim() || undefined, lastName.value.trim() || undefined);
    }
    void router.push({ name: 'overview' });
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}

async function submitForgot() {
  error.value = '';
  busy.value = true;
  try {
    await api.forgotPassword(email.value.trim());
    forgotSent.value = true; // 恒成功文案，不暴露邮箱是否存在
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}

async function submitReset() {
  error.value = '';
  if (resetPass.value.length < 8) {
    error.value = 'Password must be at least 8 characters';
    return;
  }
  if (resetPass.value !== resetPass2.value) {
    error.value = 'Passwords do not match';
    return;
  }
  busy.value = true;
  try {
    await api.resetPassword(resetToken.value ?? '', resetPass.value);
    // 成功：清掉 URL 里的 token，回登录并提示
    resetToken.value = null;
    resetPass.value = '';
    resetPass2.value = '';
    void router.replace({ name: 'login' });
    mode.value = 'login';
    error.value = '';
    forgotSent.value = false;
    resetDone.value = true;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="auth-page">
    <!-- 居中 logo（卡片之外，对标 n8n） -->
    <div class="auth-logo">
      <svg class="logo-mark" viewBox="19 37 130 54" fill="none">
        <defs>
          <linearGradient id="nomops-mark-auth" gradientUnits="userSpaceOnUse" x1="23" y1="64" x2="145" y2="64">
            <stop offset="0" stop-color="#22d3ee" />
            <stop offset="0.5" stop-color="#6366f1" />
            <stop offset="1" stop-color="#a855f7" />
          </linearGradient>
        </defs>
        <path d="M57 64C73.2 90 75.4 90 84 64C92.6 38 94.8 38 111 64" stroke="url(#nomops-mark-auth)" stroke-width="6.5" stroke-linecap="round" />
        <circle cx="40" cy="64" r="17" fill="url(#nomops-mark-auth)" />
        <circle cx="128" cy="64" r="17" fill="url(#nomops-mark-auth)" />
      </svg>
      <span class="logo-word">nomops</span>
    </div>

    <div class="auth-card">
      <!-- 重置密码落地（?reset=token） -->
      <template v-if="resetToken">
        <h1 class="card-title">Set a new password</h1>
        <form @submit.prevent="submitReset">
          <label class="field-label">New password <span class="req">*</span></label>
          <input v-model="resetPass" data-test="reset-pass" type="password" required minlength="8" />
          <p class="field-hint">8+ characters, at least 1 number and 1 capital letter</p>
          <label class="field-label">Confirm new password <span class="req">*</span></label>
          <input v-model="resetPass2" data-test="reset-pass2" type="password" required />
          <p v-if="error" class="error-text" data-test="auth-error">{{ error }}</p>
          <div class="submit-row">
            <button class="submit-btn" data-test="reset-submit" type="submit" :disabled="busy">
              {{ busy ? 'Working…' : 'Set new password' }}
            </button>
          </div>
        </form>
      </template>

      <!-- 忘记密码请求 -->
      <template v-else-if="mode === 'forgot'">
        <h1 class="card-title">Forgot my password</h1>
        <form @submit.prevent="submitForgot">
          <label class="field-label">Email</label>
          <input v-model="email" data-test="forgot-email" type="email" required />
          <p v-if="forgotSent" class="hint-text" data-test="forgot-sent">If that email is registered, a reset link has been sent. (Local dev: check the server logs.)</p>
          <p v-else-if="error" class="error-text" data-test="auth-error">{{ error }}</p>
          <div class="submit-row">
            <button class="submit-btn" data-test="forgot-submit" type="submit" :disabled="busy">
              {{ busy ? 'Working…' : 'Send reset link' }}
            </button>
          </div>
          <a href="#" class="aux-link" data-test="back-to-login" @click.prevent="mode = 'login'; error = ''; forgotSent = false">Back to sign in</a>
        </form>
      </template>

      <!-- 首个用户：owner setup（对标 n8n /setup） -->
      <template v-else-if="mode === 'setup'">
        <h1 class="card-title">Set up owner account</h1>
        <form @submit.prevent="submit">
          <label class="field-label">Email <span class="req">*</span></label>
          <input v-model="email" data-test="email" type="email" required autocomplete="email" />
          <label class="field-label">First Name <span class="req">*</span></label>
          <input v-model="firstName" data-test="first-name" type="text" required autocomplete="given-name" />
          <label class="field-label">Last Name <span class="req">*</span></label>
          <input v-model="lastName" data-test="last-name" type="text" required autocomplete="family-name" />
          <label class="field-label">Password <span class="req">*</span></label>
          <input v-model="password" data-test="password" type="password" required autocomplete="new-password" />
          <p class="field-hint">8+ characters, at least 1 number and 1 capital letter</p>
          <label class="check-row">
            <input v-model="wantUpdates" type="checkbox" data-test="want-updates" />
            <span>I want to receive security and product updates</span>
          </label>
          <p v-if="error" class="error-text" data-test="auth-error">{{ error }}</p>
          <div class="submit-row">
            <button class="submit-btn" data-test="submit" type="submit" :disabled="busy">
              {{ busy ? 'Working…' : 'Next' }}
            </button>
          </div>
        </form>
      </template>

      <!-- 登录 -->
      <template v-else>
        <h1 class="card-title">Sign in</h1>
        <p v-if="resetDone" class="hint-text" data-test="reset-done">Password updated — please sign in with your new password.</p>
        <form @submit.prevent="submit">
          <template v-if="ldapMode">
            <label class="field-label">LDAP username</label>
            <input v-model="email" data-test="ldap-username" type="text" required />
          </template>
          <template v-else>
            <label class="field-label">Email</label>
            <input v-model="email" data-test="email" type="email" required autocomplete="email" />
          </template>
          <label class="field-label">Password</label>
          <input v-model="password" data-test="password" type="password" required :minlength="ldapMode ? 1 : 8" autocomplete="current-password" />

          <template v-if="mfaRequired">
            <label class="field-label">Two-factor code</label>
            <input
              v-model="mfaCode"
              data-test="mfa-code"
              type="text"
              inputmode="numeric"
              autocomplete="one-time-code"
              placeholder="6-digit code or a backup code"
            />
          </template>

          <p v-if="error" class="error-text" data-test="auth-error">{{ error }}</p>

          <div class="submit-row">
            <button class="submit-btn" data-test="submit" type="submit" :disabled="busy">
              {{ busy ? 'Working…' : ldapMode ? 'Sign in with LDAP' : mfaRequired ? 'Verify' : 'Sign in' }}
            </button>
          </div>

          <a
            v-if="!ldapMode && !mfaRequired"
            href="#"
            class="forgot-link"
            data-test="forgot-link"
            @click.prevent="mode = 'forgot'; error = ''"
          >Forgot my password</a>

          <a v-if="ssoEnabled && !ldapMode" class="aux-link" href="/sso/login" data-test="sso-login">Sign in with SSO</a>
          <a
            v-if="ldapEnabled"
            href="#"
            class="aux-link"
            data-test="ldap-toggle"
            @click.prevent="ldapMode = !ldapMode; error = ''"
          >
            {{ ldapMode ? 'Use email and password' : 'Sign in with LDAP' }}
          </a>
        </form>
      </template>
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
  align-items: center;
  padding: 64px 16px 40px;
}

/* logo：图标 + 字标，居中在卡片上方 */
.auth-logo { display: flex; align-items: center; gap: 10px; margin-bottom: 44px; }
.logo-mark { width: 58px; height: 24px; }
.logo-word { font-size: 26px; font-weight: 700; letter-spacing: -0.5px; color: var(--text-hi); }

.auth-card {
  width: 440px;
  max-width: 94vw;
  background: var(--auth-card);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 40px 32px 44px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.25);
}
.card-title {
  margin: 0 0 34px;
  font-size: 24px;
  font-weight: 500;
  color: var(--text-hi);
  text-align: center;
  letter-spacing: -0.2px;
}

.field-label {
  display: block;
  margin: 18px 0 8px;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-hi);
}
form .field-label:first-child { margin-top: 0; }
.req { color: var(--accent); font-weight: 600; }

.auth-card input:not([type='checkbox']) {
  width: 100%;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 10px 12px;
  font-size: 14px;
  color: var(--text-hi);
}
/* 对标 n8n：聚焦描边用品牌渐变里的紫 */
.auth-card input:not([type='checkbox']):focus { outline: none; border-color: #6366f1; }

.field-hint { margin: 7px 0 0; font-size: 12px; color: var(--text-dim); }

.check-row {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  margin-top: 18px;
  font-size: 14px;
  color: var(--text-hi);
  cursor: pointer;
  line-height: 1.4;
}
.check-row input[type='checkbox'] {
  width: 16px; height: 16px; flex: 0 0 auto; margin: 2px 0 0;
  accent-color: var(--accent);
}

/* 按钮：橙色、自适应宽、居中（对标 n8n 的 Next / Sign in） */
.submit-row { display: flex; justify-content: center; margin-top: 34px; }
.submit-btn {
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: 6px;
  padding: 11px 24px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}
.submit-btn:hover { filter: brightness(1.06); }
.submit-btn:disabled { opacity: 0.6; cursor: not-allowed; }

.forgot-link {
  display: block;
  text-align: center;
  margin-top: 22px;
  font-size: 14px;
  color: var(--accent);
  text-decoration: none;
}
.forgot-link:hover { text-decoration: underline; }

.aux-link {
  display: block;
  text-align: center;
  margin-top: 14px;
  font-size: 13px;
  color: var(--text-dim);
  text-decoration: none;
}
.aux-link:hover { color: var(--text-hi); }

.error-text { color: #e5484d; font-size: 13px; margin: 12px 0 0; }
.hint-text { color: var(--text-dim); font-size: 13px; margin: 0 0 14px; text-align: center; }
</style>
