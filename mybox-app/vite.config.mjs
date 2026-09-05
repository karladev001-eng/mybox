import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// React refresh preserves the runtime ref and its registered Operation handlers.
// Reload the document when those definitions change so UI and Host stay in sync.
export function reloadHostDefinitions() {
  return {
    name: "mybox-reload-host-definitions",
    handleHotUpdate({ file, server }) {
      const path = file.replaceAll("\\", "/");
      if (!/\/src\/(?:core\/[^/]+\.(?:js|json)|knowledge\/[^/]+\.js|image-studio\/app\.js)$/.test(path)) return;
      server.ws.send({ type: "full-reload", path: "*" });
      return [];
    },
  };
}

export default defineConfig({
  clearScreen: false,
  build: {
    outDir: "dist/client",
  },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  optimizeDeps: {
    include: ["react", "react-dom/client"],
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    allowedHosts: ["terminal.local"],
    warmup: {
      clientFiles: ["./src/main.jsx"],
    },
  },
  plugins: [reloadHostDefinitions(), react()],
});
