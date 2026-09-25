/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The API runs on :3000 (npm run start:dev in the repo root); proxying keeps requests same-origin.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/health': 'http://localhost:3000',
    },
  },
  test: {
    // jsdom provides localStorage, window events and fetch plumbing for the API client tests.
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
