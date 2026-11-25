import { defineConfig } from 'vitest/config';

// Served from the site root (https://underworld.bristleconelab.org). Set BASE=/some/path/ for a sub-path.
export default defineConfig({
  base: process.env.BASE ?? '/',
  build: { target: 'es2022', chunkSizeWarningLimit: 1200 },
  test: { environment: 'node', include: ['test/**/*.test.ts'] },
});
