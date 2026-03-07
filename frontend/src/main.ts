import '@fontsource-variable/space-grotesk'
import '@fontsource-variable/jetbrains-mono'
import './assets/styles/main.css'

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { createRouter, createWebHistory } from 'vue-router'
import Antd from 'ant-design-vue'
import App from './App.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'setup', component: () => import('./views/SetupView.vue') },
    { path: '/experiment/:id', name: 'simulation', component: () => import('./views/SimulationView.vue') },
    { path: '/experiment/:id/report', name: 'report', component: () => import('./views/ReportView.vue') },
  ],
})

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.use(Antd)
app.mount('#app')
