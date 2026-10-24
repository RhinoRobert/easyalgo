import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// PNET LaunchLab, standalone. Dev and preview both bind to localhost only (a wallet-signing app has no business on the network).
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      // Tinyman only needs synchronous SHA-256; use the audited noble implementation
      // instead of a general Node compatibility bundle.
      { find: "crypto", replacement: fileURLToPath(new URL("./src/shims/nodeCrypto.js", import.meta.url)) },
      // One algosdk for the app, Pera Connect and the Tinyman SDK. The Tinyman SDK is CommonJS and would
      // otherwise bundle a second copy whose Address class fails `instanceof` in the app's copy ("Not an address").
      { find: /^algosdk$/, replacement: fileURLToPath(new URL("./node_modules/algosdk/dist/esm/index.js", import.meta.url)) },
    ],
  },
  server: { host: "127.0.0.1", port: 5180, strictPort: true },
  preview: { host: "127.0.0.1", port: 5180, strictPort: true },
  test: {
    environment: "jsdom",
    // Tests assert the unconfigured state, so they must not pick up the real MainNet values in .env.local.
    env: { VITE_NETWORK: "", VITE_LAUNCHPAD_V2_APP_ID: "", VITE_ENABLE_MAINNET_LAUNCHPAD: "", VITE_SHOW_DEPLOYMENT_CONSOLE: "" },
    setupFiles: ["./src/test-setup.js"],
    include: ["src/**/*.test.{js,jsx}"],
  },
});
