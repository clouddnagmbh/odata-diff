import { defineConfig } from 'vite';

// One self-contained file for `npx odatatailor-diff`: odata-core is bundled in,
// Node built-ins stay external, nothing is installed at run time (ADR-013).
export default defineConfig({
  build: {
    ssr: 'src/bin.ts',
    outDir: 'dist',
    target: 'node20',
    minify: false,
    sourcemap: true,
    emptyOutDir: true,
    rollupOptions: {
      output: { entryFileNames: 'cli.js', format: 'es', banner: '#!/usr/bin/env node' },
    },
  },
  ssr: { noExternal: true, target: 'node' },
});
