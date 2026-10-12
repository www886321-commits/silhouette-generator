import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
export default defineConfig({ base: './', plugins: [react()], worker: { format: 'es' }, server: { host: '127.0.0.1' } })
