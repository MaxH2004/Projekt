import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

// NestJS needs decorator metadata; SWC emits it, esbuild does not.
export default defineConfig({
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
