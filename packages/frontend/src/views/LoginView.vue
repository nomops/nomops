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
        <h1 class="card-title">Recover password</h1>
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
/* ══ n8n 2.30.4 /signin 实测（1440×840, dark）══
   页面平铺 light-2；logo 块高 52 顶距 35，与卡片间距 19；
   卡片 352 宽 / light-3 / 1px white-alpha-100 / 圆角 8 / 衬 24 / 投影 rgba(99,77,255,.06) 0 4px 16px；
   标题 20/400 行高 25 距下 32；label 14/500 白衬下 8；
   输入 36 高 / 圆角 6 / bg light-2 / inset 1px 环(聚焦=purple-500) / 字 14 衬 0 12；
   按钮 36 高橙 primary 圆角 6 衬 0 16 距上 32；链接 16/400 橙无下划线距上 16 */
.auth-page {
  flex: 1;
  min-height: 100vh;
  background: var(--auth-bg);
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 35px 16px 40px;
}

/* logo：图标 + 字标，居中在卡片上方（尺寸对齐 n8n logo 块 52 高） */
.auth-logo { display: flex; align-items: center; gap: 10px; height: 52px; margin-bottom: 19px; }
.logo-mark { width: 58px; height: 24px; }
.logo-word { font-size: 26px; font-weight: 700; letter-spacing: -0.5px; color: var(--text-hi); }

.auth-card {
  width: 352px;
  max-width: 94vw;
  background: var(--auth-card);
  border: var(--border-width) var(--border-style) var(--border-color);
  border-radius: 8px;
  padding: 24px;
  box-shadow: 0 4px 16px rgba(99, 77, 255, 0.06);
  box-sizing: border-box;
}
.card-title {
  margin: 0 0 32px;
  font-size: 20px;
  font-weight: var(--font-weight--regular);
  line-height: 25px;
  color: var(--color--text--shade-1);
  text-align: center;
}

.field-label {
  display: block;
  margin: 16px 0 0;
  padding-bottom: 8px;
  font-size: var(--font-size--sm);
  font-weight: var(--font-weight--medium);
  line-height: 18.9px; /* n8n 实测 label 文本行高（14px × 1.35） */
  color: var(--color--text--shade-1);
}
form .field-label:first-child { margin-top: 0; }
.req { color: var(--accent); font-weight: var(--font-weight--medium); }

.auth-card input:not([type='checkbox']) {
  width: 100%;
  height: 36px;
  background: var(--color--background--light-2);
  border: none;
  border-radius: 6px;
  box-shadow: inset 0 0 0 1px var(--border-color);
  padding: 0 12px;
  font-size: var(--font-size--sm);
  color: var(--color--text--shade-1);
  box-sizing: border-box;
}
/* n8n 实测：聚焦环 = purple-500（同卡片投影紫系） */
.auth-card input:not([type='checkbox']):focus {
  outline: none;
  box-shadow: inset 0 0 0 1px var(--color--purple-500);
}

.field-hint { margin: 7px 0 0; font-size: var(--font-size--2xs); color: var(--text-dim); }

.check-row {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  margin-top: 16px;
  font-size: var(--font-size--sm);
  color: var(--color--text--shade-1);
  cursor: pointer;
  line-height: 1.4;
}
.check-row input[type='checkbox'] {
  width: 16px; height: 16px; flex: 0 0 auto; margin: 2px 0 0;
  accent-color: var(--accent);
}

/* 按钮：n8n 实测 36 高 primary、自适应宽、居中 */
.submit-row { display: flex; justify-content: center; margin-top: 32px; }
.submit-btn {
  height: 36px;
  background: var(--button--color--background--primary);
  color: var(--button--color--text--primary);
  border: none;
  border-radius: 6px;
  padding: 0 16px;
  font-size: var(--font-size--sm);
  font-weight: var(--font-weight--medium);
  box-shadow: inset 0 0 0 1px var(--button--border-color--primary), 0 1px 3px -1px var(--color--black-alpha-100);
  cursor: pointer;
}
.submit-btn:hover { background: var(--button--color--background--primary--hover-active-focus); }
.submit-btn:disabled { opacity: 0.6; cursor: not-allowed; }

.forgot-link,
.aux-link {
  display: block;
  text-align: center;
  margin-top: 16px;
  font-size: var(--font-size--md);
  font-weight: var(--font-weight--regular);
  line-height: 19px; /* n8n 实测链接行框 19 高 */
  color: var(--color--primary);
  text-decoration: none;
}
.forgot-link:hover, .aux-link:hover { text-decoration: underline; }

.error-text { color: var(--color--danger); font-size: 13px; margin: 12px 0 0; }
.hint-text { color: var(--color--text); font-size: var(--font-size--sm); margin: 0 0 14px; text-align: center; }
</style>
