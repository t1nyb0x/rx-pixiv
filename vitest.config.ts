import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^#adapters\/(.+)$/,
        replacement: `${fileURLToPath(new URL("./src/adapters/", import.meta.url))}$1.ts`,
      },
      {
        find: /^#config\/(.+)$/,
        replacement: `${fileURLToPath(new URL("./src/config/", import.meta.url))}$1.ts`,
      },
      {
        find: /^#core\/(.+)$/,
        replacement: `${fileURLToPath(new URL("./src/core/", import.meta.url))}$1.ts`,
      },
      {
        find: /^#infrastructure\/(.+)$/,
        replacement: `${fileURLToPath(new URL("./src/infrastructure/", import.meta.url))}$1.ts`,
      },
      {
        find: /^#utils\/(.+)$/,
        replacement: `${fileURLToPath(new URL("./src/utils/", import.meta.url))}$1.ts`,
      },
    ],
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts", "src/infrastructure/http/HealthServer.ts"],
      thresholds: {
        lines: 90,
        statements: 90,
        functions: 90,
        branches: 85,
      },
    },
  },
});
