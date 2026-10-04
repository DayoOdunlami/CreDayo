import { existsSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // While this app lives inside the legacy repo, reuse the repo-root .env (VITE_MAPTILER_KEY).
  envDir: existsSync('.env') ? '.' : '..',
  server: { host: true },
  preview: { host: true },
});
