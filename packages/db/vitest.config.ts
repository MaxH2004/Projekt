import { defineConfig } from "vitest/config";

// The test files share one database and reset its schema.
export default defineConfig({ test: { fileParallelism: false } });
