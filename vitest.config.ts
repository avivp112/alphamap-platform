import { defineConfig } from "vitest/config";

// Separate from vite.config.ts on purpose: that config is for the frontend
// build (React/Tailwind/figma asset plugins) and has nothing to do with
// testing plain Node/TypeScript modules under lib/ and scripts/. Keeping
// this minimal avoids pulling frontend-only plugins into the test run.
export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "scripts/**/*.test.ts"],
  },
});
