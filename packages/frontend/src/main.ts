import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { router } from './router.js';
import './style.css';
import '@vue-flow/core/dist/style.css';
import '@vue-flow/core/dist/theme-default.css';

createApp(App).use(createPinia()).use(router).mount('#app');
