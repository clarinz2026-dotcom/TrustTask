import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/unit/**/*.test.ts", "test/integration/**/*.test.ts"],
    testTimeout: 15_000,
    coverage: {
      provider: "v8",
      include: [
        "src/auth/**/*.ts",
        "src/domain/**/*.ts",
        "src/http/**/*.ts",
        "src/observability/**/*.ts",
        "src/services/**/*.ts",
      ],
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 60,
        statements: 70,
      },
    },
  },
});
