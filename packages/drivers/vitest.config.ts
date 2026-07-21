import path from "node:path";
import { defineConfig } from "vitest/config";

const sourceRoot = path.resolve(import.meta.dirname, "src");

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@thoth\/drivers\/internal\/(.*)$/,
        replacement: `${sourceRoot}/$1`,
      },
      {
        find: "@thoth/drivers/agent-runtime",
        replacement: path.join(sourceRoot, "agent-runtime.ts"),
      },
      {
        find: "@thoth/drivers/harness",
        replacement: path.join(sourceRoot, "harness/index.ts"),
      },
      {
        find: "@thoth/drivers/clarify",
        replacement: path.join(sourceRoot, "clarify/index.ts"),
      },
      {
        find: "@thoth/drivers",
        replacement: path.join(sourceRoot, "index.ts"),
      },
    ],
  },
  test: {
    exclude: ["**/*.real.e2e.test.ts", "**/*.local.e2e.test.ts"],
  },
});
