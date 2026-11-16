// Checks the fixed folder structure from docs/STRUCTURE.md.
// New entries need a decision in docs/adr/ and a change here.
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = new URL("../../", import.meta.url).pathname;

const ALLOWED = {
  ".": [
    "apps", "packages", "docs", "infra", "tests", ".github",
    "CLAUDE.md", "README.md", "package.json", "pnpm-workspace.yaml", "pnpm-lock.yaml",
    "tsconfig.base.json", ".dependency-cruiser.cjs", ".gitignore", ".nvmrc", ".env.example",
  ],
  apps: ["web", "api", "worker"],
  packages: ["settlement-engine", "db", "contracts", "integrations", "pdf-templates", "ui"],
  docs: ["adr", "domain-rules", "STRUCTURE.md"],
  infra: ["scripts", "compose.yaml"],
  tests: ["e2e"],
  "apps/api/src/modules": [
    "health", "organization", "property", "tenancy", "metering", "finance",
    "banking", "documents", "settlement", "deadlines", "tax", "subscription",
  ],
};
const IGNORED = new Set([".git", "node_modules", ".env"]);

const errors = [];
for (const [dir, allowed] of Object.entries(ALLOWED)) {
  for (const entry of readdirSync(join(root, dir))) {
    if (IGNORED.has(entry) || allowed.includes(entry)) continue;
    errors.push(`${join(dir, entry)} is not part of docs/STRUCTURE.md`);
  }
}
for (const mod of readdirSync(join(root, "apps/api/src/modules"))) {
  const dir = join(root, "apps/api/src/modules", mod);
  if (statSync(dir).isDirectory() && !readdirSync(dir).includes("index.ts")) {
    errors.push(`apps/api/src/modules/${mod} has no index.ts`);
  }
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log("Folder structure OK");
