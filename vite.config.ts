import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// base must match the GitHub Pages sub-path (https://<user>.github.io/<repo>/).
// Deploys are driven by CI, which sets VITE_BASE; local dev serves from root.
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  plugins: [react(), tailwindcss()],
})
