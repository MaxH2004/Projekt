/** Architecture boundaries. The rules are described in docs/STRUCTURE.md. */
module.exports = {
  forbidden: [
    {
      name: "engine-is-pure",
      comment: "The settlement engine imports nothing outside its own package: no database, no network, no Node modules.",
      severity: "error",
      from: { path: "^packages/settlement-engine/src", pathNot: "\\.test\\.ts$" },
      to: { pathNot: "^packages/settlement-engine/src" },
    },
    {
      name: "packages-do-not-know-apps",
      severity: "error",
      from: { path: "^packages/" },
      to: { path: "^apps/" },
    },
    {
      name: "apps-do-not-know-each-other",
      severity: "error",
      from: { path: "^apps/([^/]+)/" },
      to: { path: "^apps/", pathNot: "^apps/$1/" },
    },
    {
      name: "modules-only-via-index",
      comment: "An API module may address another one only through its index.ts.",
      severity: "error",
      from: { path: "^apps/api/src/modules/([^/]+)/" },
      to: {
        path: "^apps/api/src/modules/[^/]+/",
        pathNot: ["^apps/api/src/modules/$1/", "^apps/api/src/modules/[^/]+/index\\.ts$"],
      },
    },
    {
      name: "modules-only-via-index-from-outside",
      severity: "error",
      from: { path: "^apps/api/src/", pathNot: "^apps/api/src/modules/" },
      to: { path: "^apps/api/src/modules/[^/]+/", pathNot: "^apps/api/src/modules/[^/]+/index\\.ts$" },
    },
    {
      name: "no-cycles",
      severity: "error",
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "(^|/)(dist|\\.next|node_modules)/" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.base.json" },
  },
};
