import { createApp } from 'vue'

import './assets/main.css'

import App from './App.vue'
import router from './router'
import { initTelemetry } from './lib/telemetry'

const app = createApp(App)

app.use(router)

// 业务闭环：监控 + 性能指标必须在挂载前初始化，才能捕获首屏异常
void initTelemetry(app)

app.mount('#app')
