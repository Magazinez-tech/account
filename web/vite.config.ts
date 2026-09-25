/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The API runs on :3000 (npm run start:dev in the repo root); proxying keeps requests same-origin.
// API_PROXY_TARGET points the dev server at another API instance (e.g. one running with the Omise gateway).
const api = process.env.API_PROXY_TARGET ?? 'http://localhost:3000'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': api,
      '/health': api,
    },
  },
  test: {
    // jsdom provides localStorage, window events and fetch plumbing for the API client tests.
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
