import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    host: true, // Allow local network access
    port: 5173  // Default Vite port
  }
})