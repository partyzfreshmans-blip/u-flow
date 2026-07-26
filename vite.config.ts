import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // In dev, /api/* is proxied to the local Express server (npm run
    // server). In production (Vercel), the same /api/* paths are served by
    // the serverless functions under api/ — no separate base URL needed.
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
})
