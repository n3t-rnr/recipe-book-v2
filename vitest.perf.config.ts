import { defineConfig } from 'vitest/config';

/**
 * Performance measurements (NF-04, Kap. 9.1 "Performance"): `pnpm perf`, run before a milestone
 * sign-off and before every release. Kept out of `pnpm test` and `pnpm verify` (vitest.config.ts only
 * runs *.test.ts files), because timings depend on the machine.
 */
export default defineConfig({
  test: {
    include: ['tests/perf/**/*.perf.ts'],
    environment: 'node',
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
