import { defineConfig } from 'vite';

export default defineConfig({
  base: './', // CRITICAL: Ensures assets are linked with relative paths for local file:/// loads!
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    emptyOutDir: true,
    // Bundle sizes might be large because we bundle Three.js and jsPDF
    chunkSizeWarningLimit: 1500
  }
});
