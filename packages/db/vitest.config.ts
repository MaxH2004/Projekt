import { defineConfig } from "vitest/config";

// Die Tests teilen sich eine Datenbank und setzen deren Schema zurück.
export default defineConfig({ test: { fileParallelism: false } });
