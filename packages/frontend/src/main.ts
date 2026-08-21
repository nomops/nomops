import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { router } from './router.js';
import { applyTheme, savedTheme } from './lib/theme.js';
import { startDomTranslation } from './lib/i18n.js';
import './design-tokens.css';
import './style.css';
import '@vue-flow/core/dist/style.css';
import '@vue-flow/core/dist/theme-default.css';

applyTheme(savedTheme());
createApp(App).use(createPinia()).use(router).mount('#app');
const rootElement = document.querySelector('#app');
if (rootElement) startDomTranslation(rootElement);
