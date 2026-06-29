import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": "/src",
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/config': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
      '/tests': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
      '/run': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
      '/status': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
      '/stop': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    }
  }
})