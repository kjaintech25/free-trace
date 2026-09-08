import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Mirror tsconfig.json's "@/*" -> "./*" path alias — vitest/vite does
    // not read tsconfig paths on its own.
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    // jsdom so component tests (components/ui) can render with
    // @testing-library/react. Pure-logic tests (e.g. lib/edges.ts, later
    // tickets) run fine under jsdom too, so one environment covers both.
    environment: "jsdom",
  },
});
