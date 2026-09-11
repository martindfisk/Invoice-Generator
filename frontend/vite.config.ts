/// <reference types="vitest/config" />
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      "/api": { target: process.env.BACKEND_URL ?? "http://localhost:8000", changeOrigin: true },
    },
  },
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.ts?(x)"],
    setupFiles: ["tests/setup.ts"],
  },
});
