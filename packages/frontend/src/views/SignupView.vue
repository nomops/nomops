<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AuthFrame from '../components/auth/AuthFrame.vue';
import { api } from '../api/client.js';
import { useAuthStore } from '../stores/auth.js';

const PASSWORD_PATTERN = /^(?=.*\d)(?=.*[A-Z]).{8,}$/;
const auth = useAuthStore();
const router = useRouter();
const route = useRoute();

const email = ref('');
const password = ref('');
const error = ref('');
const busy = ref(false);
const inviteToken = ref(String(route.query['invite'] ?? ''));
const isInvite = ref(Boolean(inviteToken.value));
const inviteLoading = ref(Boolean(inviteToken.value));
const inviteInvalid = ref(false);

onMounted(async () => {
  if (!inviteToken.value) return;
  try {
    const info = await api.lookupInvite(inviteToken.value);
    email.value = info.email;
  } catch {
    inviteInvalid.value = true;
    error.value = 'This invitation is invalid, expired, or has already been used.';
  } finally {
    inviteLoading.value = false;
  }
});

async function submit() {
  error.value = '';
  if (!PASSWORD_PATTERN.test(password.value)) {
    error.value = 'Use 8 or more characters with at least 1 number and 1 uppercase letter.';
    return;
  }
  busy.value = true;
  try {
    if (inviteToken.value) await auth.acceptInvite(inviteToken.value, password.value);
    else await auth.register(email.value, password.value);
    await router.push({ name: 'overview' });
  } catch (cause) {
    error.value = (cause as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <AuthFrame
    :title="isInvite ? 'Accept your invitation' : 'Create your account'"
    :description="isInvite ? 'Set a password to join this nomops instance.' : 'Create the owner account for this self-hosted instance.'"
    width="400px"
  >
    <div v-if="inviteLoading" role="status" data-test="invite-loading">
      <span class="auth-spinner" />
      <p class="loading-copy">Checking your invitation…</p>
    </div>

    <div v-else-if="inviteInvalid" data-test="invite-invalid">
      <p class="auth-notice error" role="alert" data-test="signup-error">{{ error }}</p>
      <RouterLink class="auth-link" to="/login">Back to sign in</RouterLink>
    </div>

    <form v-else class="auth-form" data-test="signup-form" @submit.prevent="submit">
      <label class="auth-label" for="signup-email">Email <span class="auth-required">*</span></label>
      <input id="signup-email" v-model="email" class="auth-input" data-test="signup-email" type="email" required autocomplete="email" :readonly="isInvite" autofocus />
      <label class="auth-label" for="signup-password">Password <span class="auth-required">*</span></label>
      <input id="signup-password" v-model="password" class="auth-input" data-test="signup-password" type="password" required autocomplete="new-password" />
      <p class="auth-hint">8+ characters, at least 1 number and 1 uppercase letter</p>
      <p v-if="error" class="auth-notice error" role="alert" data-test="signup-error">{{ error }}</p>
      <div class="auth-submit-row">
        <button class="primary auth-submit" data-test="signup-submit" type="submit" :disabled="busy">
          {{ busy ? (isInvite ? 'Joining…' : 'Creating…') : (isInvite ? 'Join instance' : 'Create account') }}
        </button>
      </div>
    </form>

    <template #below>
      <span class="below-copy">Already have an account? <RouterLink to="/login">Sign in</RouterLink></span>
    </template>
  </AuthFrame>
</template>

<style scoped>
.loading-copy { margin: 0; text-align: center; color: var(--color--text--tint-1); font-size: var(--font-size--sm); }
.below-copy { color: var(--color--text--tint-1); font-size: var(--font-size--xs); }
.below-copy a { color: var(--color--primary); text-decoration: none; }
.below-copy a:hover { text-decoration: underline; }
</style>
