import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// 开发期：vite 托前端，/api /auth /ws 代理到后端 5678
export default defineConfig({
  plugins: [vue()],
  server: {
    proxy: {
      '/api': 'http://localhost:5678',
      '/auth': 'http://localhost:5678',
      '/webhook': 'http://localhost:5678',
      '/healthz': 'http://localhost:5678',
      // 只代理后端 SSO 路由；/sso/done 是前端着陆页，不代理
      '/sso/login': 'http://localhost:5678',
      '/sso/callback': 'http://localhost:5678',
      '/sso/status': 'http://localhost:5678',
      '/ws': { target: 'ws://localhost:5678', ws: true },
    },
  },
});
