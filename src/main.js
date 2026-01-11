import { createApp } from 'vue'
import './style.css'
import './assets/iconFont/iconfont.css'
import './styles/music-variables.scss'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import App from './App.vue'
import router from './router'
import reveal from './directives/reveal.js'
import { reportClientError } from './config/appConfig.js'

const app = createApp(App)

app.use(router)
app.use(ElementPlus)
app.directive('reveal', reveal)

app.config.errorHandler = (err, instance, info) => {
  console.error(err)
  reportClientError({
    type: 'vue-error',
    message: err?.message || String(err),
    stack: err?.stack || '',
    info: String(info || ''),
  })
}

window.addEventListener('error', (event) => {
  reportClientError({
    type: 'window-error',
    message: event?.message || 'Unknown error',
    stack: event?.error?.stack || '',
    source: event?.filename || '',
    line: event?.lineno || 0,
    column: event?.colno || 0,
  })
})

window.addEventListener('unhandledrejection', (event) => {
  const reason = event?.reason
  reportClientError({
    type: 'unhandledrejection',
    message: reason?.message || String(reason || 'Unhandled rejection'),
    stack: reason?.stack || '',
  })
})

app.mount('#app')
