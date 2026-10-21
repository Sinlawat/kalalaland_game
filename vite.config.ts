import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // './' makes every asset path relative, so the built site works under
  // https://<user>.github.io/<repo>/ without hard-coding the repo name.
  base: './',
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
