import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

// Midnight's runtime is WASM. `@midnight-ntwrk/ledger-v8` and
// `@midnight-ntwrk/onchain-runtime-v3` both expose a `browser` conditional
// export pointing at a wasm-bindgen bundler build, which imports the `.wasm`
// file directly and initialises it with a top-level await. esbuild's dependency
// pre-bundling handles neither, hence `vite-plugin-wasm` plus the optimizeDeps
// exclusions. Top-level await needs no plugin here because the build targets
// `esnext`, which supports it natively.
export default defineConfig({
  plugins: [
    react(),
    wasm(),
    // `wallet-sdk-address-format` and the private-state store are written
    // against Node's Buffer.
    nodePolyfills({ include: ['buffer'], globals: { Buffer: true } }),
  ],
  optimizeDeps: {
    exclude: [
      '@midnight-ntwrk/onchain-runtime-v3',
      '@midnight-ntwrk/ledger-v8',
      // These two re-export the WASM packages above, so pre-bundling them
      // drags the `.wasm` imports into the optimizer as well.
      '@midnight-ntwrk/compact-runtime',
      '@midnight-ntwrk/midnight-js-protocol',
    ],
    // Excluded packages are served raw, which means their own CommonJS
    // dependencies arrive un-interopped — `compact-runtime` does
    // `import inspect from 'object-inspect'` and dev would otherwise fail with
    // "does not provide an export named 'default'". Pre-bundling the CJS leaf
    // fixes the interop without pre-bundling its WASM-bearing parent.
    include: ['object-inspect'],
  },
  build: {
    // Also what makes the WASM packages' top-level await work without a plugin.
    target: 'esnext',
    // The ledger WASM blob is ~10 MB; it is an emitted asset, not application
    // code, so the size warning would only be noise.
    chunkSizeWarningLimit: 4096,
  },
  server: { fs: { allow: ['.'] } },
});
