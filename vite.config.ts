import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Split stable vendor packages into separate chunks for better CDN caching.
        // App code changes every deploy; React/Supabase/Zustand don't.
        manualChunks(id) {
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom') || id.includes('node_modules/react-router')) return 'vendor-react'
          if (id.includes('node_modules/zustand') || id.includes('node_modules/@tanstack')) return 'vendor-state'
          if (id.includes('node_modules/@supabase')) return 'vendor-supabase'
          if (id.includes('node_modules/@clerk')) return 'vendor-clerk'
          if (id.includes('node_modules/zod')) return 'vendor-zod'
        },
      },
    },
  },
})
