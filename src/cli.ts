/**
 * svelte-fast-check CLI
 */

import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
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
      description: "Path to svelte-fast-check.config.ts",
    },
    project: {
      type: String,
      alias: "p",
      description: "Path to tsconfig.json (for monorepo support)",
    },
  },
  help: {
    description:
      "Fast type checking for Svelte/SvelteKit projects using svelte2tsx + tsgo",
  },
});

/**
 * Parse tsconfig.json to derive rootDir
 */
function parseProjectConfig(tsconfigPath: string): {
  rootDir: string;
  srcDir: string;
} {
  const absolutePath = resolve(process.cwd(), tsconfigPath);

  if (!existsSync(absolutePath)) {
    console.error(`Error: tsconfig.json not found at ${absolutePath}`);
    process.exit(1);
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
    svelteWarnings,
    config: configArg,
    project: projectArg,
  } = argv.flags;

  // Validate: --config should not receive .json files
  if (configArg?.endsWith(".json")) {
    console.error(
      `Error: --config expects a JavaScript/TypeScript config file (e.g., svelte-fast-check.config.ts)`,
    );
    console.error(`       Did you mean --project ${configArg}?`);
    process.exit(1);
  }

  // Determine rootDir based on --project flag or cwd
  let projectConfig: { rootDir: string; srcDir: string } | undefined;
  if (projectArg) {
    projectConfig = parseProjectConfig(projectArg);
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
      console.error(`Failed to load config from ${configPath}:`, e);
      process.exit(1);
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
