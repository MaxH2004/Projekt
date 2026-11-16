/** Architekturgrenzen. Die Regeln sind in docs/STRUKTUR.md beschrieben. */
module.exports = {
  forbidden: [
    {
      name: "engine-ist-rein",
      comment: "Die Abrechnungs-Engine importiert nichts außerhalb ihres eigenen Pakets: keine Datenbank, kein Netz, keine Node-Module.",
      severity: "error",
      from: { path: "^packages/settlement-engine/src", pathNot: "\\.test\\.ts$" },
      to: { pathNot: "^packages/settlement-engine/src" },
    },
    {
      name: "pakete-kennen-keine-apps",
      severity: "error",
      from: { path: "^packages/" },
      to: { path: "^apps/" },
    },
    {
      name: "apps-kennen-einander-nicht",
      severity: "error",
      from: { path: "^apps/([^/]+)/" },
      to: { path: "^apps/", pathNot: "^apps/$1/" },
    },
    {
      name: "module-nur-ueber-index",
      comment: "Ein API-Modul darf ein anderes nur über dessen index.ts ansprechen.",
      severity: "error",
      from: { path: "^apps/api/src/modules/([^/]+)/" },
      to: {
        path: "^apps/api/src/modules/[^/]+/",
        pathNot: ["^apps/api/src/modules/$1/", "^apps/api/src/modules/[^/]+/index\\.ts$"],
      },
    },
    {
      name: "module-nur-ueber-index-von-aussen",
      severity: "error",
      from: { path: "^apps/api/src/", pathNot: "^apps/api/src/modules/" },
      to: { path: "^apps/api/src/modules/[^/]+/", pathNot: "^apps/api/src/modules/[^/]+/index\\.ts$" },
    },
    {
      name: "keine-zyklen",
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
