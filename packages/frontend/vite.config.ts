import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// 开发期：vite 托前端，/api /auth /ws 代理到后端 5680(基线实例占用 5678)
export default defineConfig({
  plugins: [vue()],
  server: {
    proxy: {
      '/api': 'http://localhost:5680',
      '/auth': 'http://localhost:5680',
      '/webhook': 'http://localhost:5680',
      '/healthz': 'http://localhost:5680',
      // 只代理后端 SSO 路由；/sso/done 是前端着陆页，不代理
      '/sso/login': 'http://localhost:5680',
      '/sso/callback': 'http://localhost:5680',
      '/sso/status': 'http://localhost:5680',
      '/ws': { target: 'ws://localhost:5680', ws: true },
    },
  },
});
