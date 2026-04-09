import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import reviewApiPlugin from './vite-plugin-review-api.js'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), reviewApiPlugin()],
})
