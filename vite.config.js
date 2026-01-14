import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
      "/wapi": {
        // 网易云的音乐代理
        target: "http://mrzym.top:3000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/wapi/, ""),
      },
      '/music': {
        target: 'https://music.163.com',
        changeOrigin: true, 
        rewrite: (path) => path.replace(/^\/music/, ''),
        secure: false,
      },
    },
  },
})
