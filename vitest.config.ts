import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/bin.ts'],
      reporter: ['text-summary', 'json-summary', 'html'],
      thresholds: { lines: 85, statements: 85, functions: 85, branches: 80 },
    },
  },
});
