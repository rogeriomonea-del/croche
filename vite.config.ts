import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  // Served from the site root by the backend, which falls back to index.html on deep links; a
  // relative base would resolve assets against those links.
  base: '/',
  plugins: [react(), tailwindcss()],
  server: {
    proxy: { '/api': 'http://127.0.0.1:3000' },
  },
  test: {
    include: ['src/**/*.test.ts', 'server/**/*.test.ts'],
  },
})
