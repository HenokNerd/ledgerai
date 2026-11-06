import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'client',
  publicDir: '../public',
  plugins: [react()],
  server: { host: '0.0.0.0', port: 3000, strictPort: true, allowedHosts: ['.us4.manus.computer'] },
  build: { outDir: '../dist', emptyOutDir: true },
});
