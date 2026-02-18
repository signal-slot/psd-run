import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],

  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless'
    }
  },

  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless'
    }
  },

  build: {
    target: 'esnext',
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
          zustand: ['zustand']
        }
      }
    }
  },

  optimizeDeps: {
    exclude: ['psdrun_qt']
  },

  assetsInclude: ['**/*.wasm']
});
