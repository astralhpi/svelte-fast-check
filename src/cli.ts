/**
 * svelte-fast-check CLI
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { cli } from "cleye";
import { runFastCheck } from "./index";
import type { FastCheckConfig } from "./types";

const argv = cli({
  name: "svelte-fast-check",
  version: "0.2.1",
  flags: {
    incremental: {
      type: Boolean,
      alias: "i",
      description: "Convert only changed files (recommended)",
      default: false,
    },
    raw: {
      type: Boolean,
      alias: "r",
      description: "Raw output without filtering/mapping",
      default: false,
    },
    svelteWarnings: {
      type: Boolean,
      description: "Show svelte compiler warnings",
      default: true,
    },
    config: {
      type: String,
      alias: "c",
      description: "Specify config file path",
    },
  },
  help: {
    description:
      "Fast type checking for Svelte/SvelteKit projects using svelte2tsx + tsgo",
  },
});

async function main() {
  const { incremental, raw, svelteWarnings, config: configArg } = argv.flags;

  // find config file
  let configPath: string | undefined;
  if (configArg) {
    configPath = resolve(process.cwd(), configArg);
  }

  // default config (SvelteKit project)
  let config: FastCheckConfig = {
    rootDir: process.cwd(),
    srcDir: resolve(process.cwd(), "src"),
    // paths are automatically read from tsconfig.json
  };

  // load config file if exists
  if (configPath && existsSync(configPath)) {
    try {
      const loaded = await import(configPath);
      config = { ...config, ...loaded.default };
    } catch (e) {
      console.error(`Failed to load config from ${configPath}:`, e);
      process.exit(1);
    }
  }

  // auto-detect svelte-fast-check.config.ts
  const defaultConfigPath = resolve(
    process.cwd(),
    "svelte-fast-check.config.ts",
  );
  if (!configPath && existsSync(defaultConfigPath)) {
    try {
      const loaded = await import(defaultConfigPath);
      config = { ...config, ...loaded.default };
    } catch {
      // ignore config load failure
    }
  }

  const result = await runFastCheck(config, {
    incremental,
    raw,
    svelteWarnings,
  });

  // exit with code 1 if there are errors
  if (result.errorCount > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
