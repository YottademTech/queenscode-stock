import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  // Relative asset paths let the built app be hosted under any folder.
  base: './',
  // One .env at the project root holds every secret. Vite only ever exposes its VITE_ entries
  // to the app, so the Claude API key in the same file cannot reach the browser.
  envDir: '..',
});
