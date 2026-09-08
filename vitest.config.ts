import path from "node:path";
import { configDefaults, defineConfig } from "vitest/config";

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
    // tests/e2e/*.spec.ts belongs to the T-14 Playwright harness
    // (`npm run test:e2e`). Its filenames match the default `**/*.spec.ts`
    // glob, so without this exclusion `npm test` picks the harness up, loads
    // @playwright/test outside a Playwright runner and dies on import — a
    // failure that looks like a broken unit suite and is not one.
    exclude: [...configDefaults.exclude, "tests/e2e/**"],
  },
});
