import { defineStore } from 'pinia';
import { api, tokenStorage } from '../api/client.js';

export const useAuthStore = defineStore('auth', {
  state: () => ({
    token: tokenStorage.get(),
    email: localStorage.getItem('nomops.email'),
  }),
  actions: {
    async login(email: string, password: string) {
      const result = await api.login(email, password);
      this.setSession(result.token, email);
    },
    async register(email: string, password: string) {
      const result = await api.register(email, password);
      this.setSession(result.token, email);
    },
    async ldapLogin(username: string, password: string) {
      const result = await api.ldap.login(username, password);
      this.setSession(result.token, result.user.email);
    },
    setSession(token: string, email: string) {
      this.token = token;
      this.email = email;
      tokenStorage.set(token);
      localStorage.setItem('nomops.email', email);
    },
    logout() {
      this.token = null;
      this.email = null;
      tokenStorage.clear();
      localStorage.removeItem('nomops.email');
    },
  },
});
