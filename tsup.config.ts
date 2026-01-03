import { defineConfig } from "tsup";

export default defineConfig([
  // Library
  {
    entry: ["src/index.ts"],
    format: ["esm"],
    dts: true,
    clean: true,
  },
  // CLI
  {
    entry: ["src/cli.ts"],
    format: ["esm"],
    banner: {
      js: "#!/usr/bin/env node",
    },
  },
  // TypeCheck Worker
  {
    entry: ["src/typecheck/worker.ts"],
    format: ["esm"],
    outDir: "dist/typecheck",
  },
  // Compiler Worker
  {
    entry: ["src/compiler/worker.ts"],
    format: ["esm"],
    outDir: "dist/compiler",
  },
]);
