import { defineStore } from 'pinia';
import { api, tokenStorage } from '../api/client.js';

export const useAuthStore = defineStore('auth', {
  state: () => ({
    token: tokenStorage.get(),
    email: localStorage.getItem('nomops.email'),
  }),
  actions: {
    /** 登录：需二因素时返回 { mfaRequired: true } 且不建会话；成功建会话返回 {}。 */
    async login(email: string, password: string, mfaCode?: string): Promise<{ mfaRequired?: boolean }> {
      const result = await api.login(email, password, mfaCode);
      if ('mfaRequired' in result) return { mfaRequired: true };
      this.setSession(result.token, email);
      return {};
    },
    async register(email: string, password: string, firstName?: string, lastName?: string) {
      const result = await api.register(email, password, firstName, lastName);
      this.setSession(result.token, email);
    },
    /** 接受邀请：设口令建号并直接建会话。 */
    async acceptInvite(token: string, password: string) {
      const result = await api.acceptInvite(token, password);
      this.setSession(result.token, result.user.email);
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
