import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // The test files share one database and reset its schema.
  test: { fileParallelism: false, testTimeout: 20_000 },
  // NestJS needs decorator metadata; SWC emits it, esbuild does not.
  plugins: [
    swc.vite({
      jsc: {
        parser: { syntax: "typescript", decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
        target: "es2022",
      },
    }),
  ],
});
