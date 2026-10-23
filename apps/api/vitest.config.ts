import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    testTimeout: 45_000,
    hookTimeout: 90_000,
    pool: 'forks',
    poolOptions: { forks: { maxForks: 4, minForks: 1 } },
    sequence: { concurrent: false },
    reporters: ['default'],
  },
});
