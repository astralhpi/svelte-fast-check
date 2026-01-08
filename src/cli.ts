/**
 * svelte-fast-check CLI
 */

import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { cli } from "cleye";
import { runFastCheck } from "./index";
import type { FastCheckConfig } from "./types";

/**
 * CLI-specific error for user-friendly messages
 */
class CliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliError";
  }
}

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
    noSvelteWarnings: {
      type: Boolean,
      description: "Disable svelte compiler warnings",
      default: false,
    },
    config: {
      type: String,
      alias: "c",
      description: "Path to svelte-fast-check.config.ts",
    },
    project: {
      type: String,
      alias: "p",
      description: "Path to tsconfig.json (for monorepo support)",
    },
    svelteConfig: {
      type: String,
      description: "Path to svelte.config.js (auto-detected by default)",
    },
    noSvelteConfig: {
      type: Boolean,
      description: "Disable loading svelte.config.js",
      default: false,
    },
  },
  help: {
    description:
      "Fast type checking for Svelte/SvelteKit projects using svelte2tsx + tsgo",
  },
});

/**
 * Derive rootDir and srcDir from tsconfig.json path
 */
function deriveProjectPaths(tsconfigPath: string): {
  rootDir: string;
  srcDir: string;
} {
  const absolutePath = resolve(process.cwd(), tsconfigPath);

  if (!existsSync(absolutePath)) {
    throw new CliError(`--project: tsconfig.json not found at ${absolutePath}`);
  }

  // rootDir is the directory containing tsconfig.json
  const rootDir = dirname(absolutePath);
  const srcDir = resolve(rootDir, "src");

  return { rootDir, srcDir };
}

async function main() {
  const {
    incremental,
    raw,
    noSvelteWarnings,
    config: configArg,
    project: projectArg,
    svelteConfig: svelteConfigArg,
    noSvelteConfig,
  } = argv.flags;

  // Validate: --config should not receive .json files
  if (configArg?.endsWith(".json")) {
    throw new CliError(
      `--config expects a JavaScript/TypeScript config file (e.g., svelte-fast-check.config.ts)\n       Did you mean --project ${configArg}?`,
    );
  }

  // Determine rootDir based on --project flag or cwd
  let projectConfig: { rootDir: string; srcDir: string } | undefined;
  if (projectArg) {
    projectConfig = deriveProjectPaths(projectArg);
  }

  // default config (SvelteKit project)
  let config: FastCheckConfig = {
    rootDir: projectConfig?.rootDir ?? process.cwd(),
    srcDir: projectConfig?.srcDir ?? resolve(process.cwd(), "src"),
  };

  // find config file
  let configPath: string | undefined;
  if (configArg) {
    configPath = resolve(process.cwd(), configArg);
  }

  // load config file if exists
  if (configPath && existsSync(configPath)) {
    try {
      const loaded = await import(configPath);
      config = { ...config, ...loaded.default };
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      throw new CliError(`Failed to load config from ${configPath}: ${detail}`);
    }
  }

  // auto-detect svelte-fast-check.config.ts in rootDir
  const defaultConfigPath = resolve(
    config.rootDir,
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

  // Determine svelte config options
  // --no-svelte-config disables loading svelte.config.js
  // --svelte-config <path> sets custom path to svelte.config.js
  // undefined means auto-detect in rootDir
  const useSvelteConfig = !noSvelteConfig;
  const svelteConfigPath = svelteConfigArg
    ? resolve(process.cwd(), svelteConfigArg)
    : undefined;

  const result = await runFastCheck(config, {
    incremental,
    raw,
    svelteWarnings: !noSvelteWarnings,
    useSvelteConfig,
    svelteConfigPath,
  });

  // exit with code 1 if there are errors
  if (result.errorCount > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  if (err instanceof CliError) {
    console.error(`Error: ${err.message}`);
  } else {
    console.error("Fatal error:", err);
  }
  process.exit(1);
});
