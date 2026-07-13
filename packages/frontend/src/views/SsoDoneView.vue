<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { tokenStorage } from '../api/client.js';
import { useAuthStore } from '../stores/auth.js';

/** SSO 回调着陆页：/sso/done?token=<jwt>（docs/07 流程末端）。 */
const router = useRouter();
const auth = useAuthStore();
const error = ref('');

onMounted(async () => {
  const token = new URLSearchParams(location.search).get('token');
  if (!token) {
    error.value = 'SSO callback is missing a token';
    return;
  }
  tokenStorage.set(token);
  try {
    const me = await (await fetch('/api/me', { headers: { authorization: `Bearer ${token}` } })).json();
    auth.setSession(token, me.email ?? 'sso-user');
    void router.replace({ name: 'overview' });
  } catch {
    error.value = 'SSO sign-in verification failed — please try again';
    tokenStorage.clear();
  }
});
</script>

<template>
  <div style="flex: 1; display: flex; align-items: center; justify-content: center">
    <div class="card" style="width: 320px; text-align: center">
      <p v-if="error" class="error-text" data-test="sso-error">{{ error }}</p>
      <p v-else class="dim">Signing in with SSO…</p>
    </div>
  </div>
</template>
