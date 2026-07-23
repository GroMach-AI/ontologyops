import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "ONTOLOGYOPS_");
  return {
    plugins: [react()],
    server: { port: 5173, proxy: { "/api": env.ONTOLOGYOPS_API_PROXY || "http://localhost:8001" } },
    test: { environment: "jsdom", setupFiles: "./src/test/setup.ts" },
  };
});
