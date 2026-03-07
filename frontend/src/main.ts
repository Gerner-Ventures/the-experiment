import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { createRouter, createWebHistory } from 'vue-router'
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
app.mount('#app')
