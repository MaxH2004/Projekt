import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

// NestJS braucht Decorator-Metadaten; die erzeugt SWC, nicht esbuild.
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
