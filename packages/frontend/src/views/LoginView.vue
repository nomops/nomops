<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AuthFrame from '../components/auth/AuthFrame.vue';
import { api } from '../api/client.js';
import { useAuthStore } from '../stores/auth.js';

type AuthMode = 'login' | 'setup' | 'forgot';
const PASSWORD_PATTERN = /^(?=.*\d)(?=.*[A-Z]).{8,}$/;

const auth = useAuthStore();
const router = useRouter();
const route = useRoute();

const mode = ref<AuthMode>('login');
const email = ref('');
const password = ref('');
const firstName = ref('');
const lastName = ref('');
const wantUpdates = ref(false);
const error = ref('');
const busy = ref(false);
const ssoEnabled = ref(false);
const ldapEnabled = ref(false);
const ldapMode = ref(false);
const mfaRequired = ref(false);
const mfaCode = ref('');
const resetToken = ref<string | null>(null);
const forgotSent = ref(false);
const resetDone = ref(false);
const resetPass = ref('');
const resetPass2 = ref('');
const emailInput = ref<HTMLInputElement | null>(null);
const mfaInput = ref<HTMLInputElement | null>(null);

function focusEmail() {
  void nextTick(() => emailInput.value?.focus());
}

function setMode(next: AuthMode) {
  mode.value = next;
  error.value = '';
  forgotSent.value = false;
  if (next !== 'login') {
    ldapMode.value = false;
    mfaRequired.value = false;
  }
  focusEmail();
}

onMounted(async () => {
  const rt = route.query['reset'];
  if (typeof rt === 'string' && rt) resetToken.value = rt;

  const [setup, sso, ldap] = await Promise.all([
    api.needsSetup().catch(() => ({ needsSetup: false })),
    fetch('/sso/status').then((response) => response.json()).catch(() => ({ enabled: false })),
    fetch('/auth/ldap/status').then((response) => response.json()).catch(() => ({ enabled: false })),
  ]);
  if (setup.needsSetup && !resetToken.value) mode.value = 'setup';
  ssoEnabled.value = Boolean(sso.enabled);
  ldapEnabled.value = Boolean(ldap.enabled);
  if (!resetToken.value) focusEmail();
});

async function submit() {
  error.value = '';
  if (mode.value === 'setup' && !PASSWORD_PATTERN.test(password.value)) {
    error.value = 'Use 8 or more characters with at least 1 number and 1 uppercase letter.';
    return;
  }
  busy.value = true;
  try {
    if (ldapMode.value) {
      await auth.ldapLogin(email.value, password.value);
    } else if (mode.value === 'login') {
      const result = await auth.login(email.value, password.value, mfaRequired.value ? mfaCode.value : undefined);
      if (result.mfaRequired) {
        mfaRequired.value = true;
        await nextTick();
        mfaInput.value?.focus();
        return;
      }
    } else {
      await auth.register(email.value, password.value, firstName.value.trim() || undefined, lastName.value.trim() || undefined);
    }
    await router.push({ name: 'overview' });
  } catch (cause) {
    error.value = (cause as Error).message;
  } finally {
    busy.value = false;
  }
}

async function submitForgot() {
  error.value = '';
  busy.value = true;
  try {
    await api.forgotPassword(email.value.trim());
    forgotSent.value = true;
  } catch (cause) {
    error.value = (cause as Error).message;
  } finally {
    busy.value = false;
  }
}

async function submitReset() {
  error.value = '';
  if (!PASSWORD_PATTERN.test(resetPass.value)) {
    error.value = 'Use 8 or more characters with at least 1 number and 1 uppercase letter.';
    return;
  }
  if (resetPass.value !== resetPass2.value) {
    error.value = 'Passwords do not match.';
    return;
  }
  busy.value = true;
  try {
    await api.resetPassword(resetToken.value ?? '', resetPass.value);
    resetToken.value = null;
    resetPass.value = '';
    resetPass2.value = '';
    await router.replace({ name: 'login' });
    mode.value = 'login';
    forgotSent.value = false;
    resetDone.value = true;
    focusEmail();
  } catch (cause) {
    error.value = (cause as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <AuthFrame v-if="resetToken" title="Set a new password" description="Choose a strong password for your account.">
    <form class="auth-form" data-test="reset-form" @submit.prevent="submitReset">
      <label class="auth-label" for="reset-password">New password <span class="auth-required">*</span></label>
      <input id="reset-password" v-model="resetPass" class="auth-input" data-test="reset-pass" type="password" required autocomplete="new-password" autofocus />
      <p class="auth-hint">8+ characters, at least 1 number and 1 uppercase letter</p>
      <label class="auth-label" for="reset-password-confirm">Confirm new password <span class="auth-required">*</span></label>
      <input id="reset-password-confirm" v-model="resetPass2" class="auth-input" data-test="reset-pass2" type="password" required autocomplete="new-password" />
      <p v-if="error" class="auth-notice error" role="alert" data-test="auth-error">{{ error }}</p>
      <div class="auth-submit-row">
        <button class="primary auth-submit" data-test="reset-submit" type="submit" :disabled="busy">
          {{ busy ? 'Updating…' : 'Set new password' }}
        </button>
      </div>
    </form>
  </AuthFrame>

  <AuthFrame v-else-if="mode === 'forgot'" title="Recover password" description="Enter your email and we’ll send password reset instructions.">
    <div v-if="forgotSent" class="auth-notice success" role="status" data-test="forgot-sent">
      If that email is registered, a reset link has been sent. In local development, check the server logs.
    </div>
    <form v-else class="auth-form" @submit.prevent="submitForgot">
      <label class="auth-label" for="forgot-email">Email</label>
      <input id="forgot-email" ref="emailInput" v-model="email" class="auth-input" data-test="forgot-email" type="email" required autocomplete="email" autofocus />
      <p v-if="error" class="auth-notice error" role="alert" data-test="auth-error">{{ error }}</p>
      <div class="auth-submit-row">
        <button class="primary auth-submit" data-test="forgot-submit" type="submit" :disabled="busy">
          {{ busy ? 'Sending…' : 'Send reset link' }}
        </button>
      </div>
    </form>
    <button type="button" class="auth-link button-link" data-test="back-to-login" @click="setMode('login')">Back to sign in</button>
  </AuthFrame>

  <AuthFrame v-else-if="mode === 'setup'" title="Set up owner account" description="Create the first account for this self-hosted instance." width="400px">
    <form class="auth-form" data-test="setup-form" @submit.prevent="submit">
      <label class="auth-label" for="setup-email">Email <span class="auth-required">*</span></label>
      <input id="setup-email" ref="emailInput" v-model="email" class="auth-input" data-test="email" type="email" required autocomplete="email" autofocus />
      <label class="auth-label" for="setup-first-name">First name <span class="auth-required">*</span></label>
      <input id="setup-first-name" v-model="firstName" class="auth-input" data-test="first-name" type="text" required autocomplete="given-name" />
      <label class="auth-label" for="setup-last-name">Last name <span class="auth-required">*</span></label>
      <input id="setup-last-name" v-model="lastName" class="auth-input" data-test="last-name" type="text" required autocomplete="family-name" />
      <label class="auth-label" for="setup-password">Password <span class="auth-required">*</span></label>
      <input id="setup-password" v-model="password" class="auth-input" data-test="password" type="password" required autocomplete="new-password" />
      <p class="auth-hint">8+ characters, at least 1 number and 1 uppercase letter</p>
      <label class="updates-row">
        <input v-model="wantUpdates" type="checkbox" data-test="want-updates" />
        <span>I want to receive security and product updates</span>
      </label>
      <p v-if="error" class="auth-notice error" role="alert" data-test="auth-error">{{ error }}</p>
      <div class="auth-submit-row">
        <button class="primary auth-submit" data-test="submit" type="submit" :disabled="busy">{{ busy ? 'Creating…' : 'Next' }}</button>
      </div>
    </form>
  </AuthFrame>

  <AuthFrame v-else title="Sign in">
    <p v-if="resetDone" class="auth-notice success" role="status" data-test="reset-done">Password updated. Sign in with your new password.</p>
    <form class="auth-form" data-test="login-form" @submit.prevent="submit">
      <label class="auth-label" :for="ldapMode ? 'ldap-username' : 'login-email'">{{ ldapMode ? 'LDAP username' : 'Email' }}</label>
      <input
        :id="ldapMode ? 'ldap-username' : 'login-email'"
        ref="emailInput"
        v-model="email"
        class="auth-input"
        :data-test="ldapMode ? 'ldap-username' : 'email'"
        :type="ldapMode ? 'text' : 'email'"
        required
        :autocomplete="ldapMode ? 'username' : 'email'"
        autofocus
      />
      <label class="auth-label" for="login-password">Password</label>
      <input id="login-password" v-model="password" class="auth-input" data-test="password" type="password" required :minlength="ldapMode ? 1 : 8" autocomplete="current-password" />

      <template v-if="mfaRequired">
        <label class="auth-label" for="mfa-code">Two-factor code</label>
        <input id="mfa-code" ref="mfaInput" v-model="mfaCode" class="auth-input" data-test="mfa-code" type="text" inputmode="numeric" autocomplete="one-time-code" placeholder="6-digit code or backup code" />
      </template>

      <p v-if="error" class="auth-notice error" role="alert" data-test="auth-error">{{ error }}</p>
      <div class="auth-submit-row">
        <button class="primary auth-submit" data-test="submit" type="submit" :disabled="busy">
          {{ busy ? 'Signing in…' : ldapMode ? 'Sign in with LDAP' : mfaRequired ? 'Verify' : 'Sign in' }}
        </button>
      </div>
      <button v-if="!ldapMode && !mfaRequired" type="button" class="auth-link button-link" data-test="forgot-link" @click="setMode('forgot')">Forgot my password</button>

      <template v-if="ssoEnabled || ldapEnabled">
        <div class="auth-divider">or</div>
        <a v-if="ssoEnabled && !ldapMode" class="auth-link provider-link" href="/sso/login" data-test="sso-login">Sign in with SSO</a>
        <button v-if="ldapEnabled" type="button" class="auth-link provider-link button-link" data-test="ldap-toggle" @click="ldapMode = !ldapMode; error = ''; focusEmail()">
          {{ ldapMode ? 'Use email and password' : 'Sign in with LDAP' }}
        </button>
      </template>
    </form>
  </AuthFrame>
</template>

<style scoped>
.updates-row {
  display: flex; align-items: flex-start; gap: var(--spacing--2xs); margin-top: var(--spacing--sm);
  color: var(--color--text--shade-1); font-size: var(--font-size--sm); line-height: var(--line-height--lg); cursor: pointer;
}
.updates-row input { width: 16px; height: 16px; flex: none; margin: 1px 0 0; accent-color: var(--color--primary); }
.provider-link { margin-top: var(--spacing--xs); }
</style>
