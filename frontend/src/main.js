import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import './utils/i18n'
import './assets/main.css'

const app = createApp(App)

app.use(router)

app.mount('#app')
