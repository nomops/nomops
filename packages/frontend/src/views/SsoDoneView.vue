<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import AuthFrame from '../components/auth/AuthFrame.vue';
import { tokenStorage } from '../api/client.js';
import { useAuthStore } from '../stores/auth.js';

const router = useRouter();
const auth = useAuthStore();
const error = ref('');

onMounted(async () => {
  const token = new URLSearchParams(location.search).get('token');
  if (!token) {
    error.value = 'SSO callback is missing a token.';
    return;
  }

  tokenStorage.set(token);
  try {
    const response = await fetch('/api/me', { headers: { authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const me = await response.json() as { email?: string };
    if (!me.email) throw new Error('SSO response is missing an email');
    auth.setSession(token, me.email);
    await router.replace({ name: 'overview' });
  } catch {
    error.value = 'SSO sign-in verification failed. Please try again.';
    tokenStorage.clear();
  }
});
</script>

<template>
  <AuthFrame :title="error ? 'Could not sign in' : 'Signing you in'" :description="error ? 'The identity provider response could not be verified.' : 'Verifying your single sign-on session…'">
    <div v-if="error" data-test="sso-error-state">
      <p class="auth-notice error" role="alert" data-test="sso-error">{{ error }}</p>
      <RouterLink class="auth-link" to="/login">Back to sign in</RouterLink>
    </div>
    <div v-else class="sso-progress" role="status" data-test="sso-loading">
      <span class="auth-spinner" />
      <span>Verifying secure session</span>
    </div>
  </AuthFrame>
</template>

<style scoped>
.sso-progress { text-align: center; color: var(--color--text--tint-1); font-size: var(--font-size--sm); }
</style>
