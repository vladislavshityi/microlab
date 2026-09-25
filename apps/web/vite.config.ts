/// <reference types="vitest/config" />
import { fileURLToPath, URL } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

// Адрес API по умолчанию для dev proxy (переопределяется через API_PROXY_TARGET).
// 127.0.0.1, а не localhost: Node может разрешить localhost в ::1, а uvicorn слушает IPv4.
const DEFAULT_API_PROXY_TARGET = "http://127.0.0.1:8000";

export default defineConfig(({ mode }) => {
  // Пустой префикс: читаем API_PROXY_TARGET (не VITE_*), чтобы он никогда не попал
  // в клиентский код.
  const env = loadEnv(mode, process.cwd(), "");
  const configuredTarget = env["API_PROXY_TARGET"];
  const apiProxyTarget =
    configuredTarget !== undefined && configuredTarget !== ""
      ? configuredTarget
      : DEFAULT_API_PROXY_TARGET;

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
    server: {
      host: "127.0.0.1",
      port: 5173,
      strictPort: true,
      proxy: {
        "/api": {
          target: apiProxyTarget,
          changeOrigin: false,
        },
      },
    },
    preview: {
      host: "127.0.0.1",
      port: 4173,
      strictPort: true,
    },
    test: {
      environment: "jsdom",
      setupFiles: ["./src/test/setup.ts"],
      include: ["src/**/*.test.{ts,tsx}"],
      restoreMocks: true,
      unstubGlobals: true,
    },
  };
});
