import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// PNET LaunchLab, standalone. Dev and preview both bind to localhost only (a wallet-signing app has no business on the network).
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Tinyman only needs synchronous SHA-256; use the audited noble implementation
      // instead of a general Node compatibility bundle.
      crypto: fileURLToPath(new URL("./src/shims/nodeCrypto.js", import.meta.url)),
    },
  },
  server: { host: "127.0.0.1", port: 5180, strictPort: true },
  preview: { host: "127.0.0.1", port: 5180, strictPort: true },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.js"],
    include: ["src/**/*.test.{js,jsx}"],
  },
});
