import { defineConfig } from "vitest/config";

// The tests share one database and reset its schema.
export default defineConfig({ test: { fileParallelism: false, testTimeout: 20_000 } });
