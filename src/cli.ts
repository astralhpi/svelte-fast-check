/**
 * svelte-fast-check CLI
 *
 * Usage:
 *   svelte-fast-check                    # basic run
 *   svelte-fast-check --incremental      # convert only changed files (recommended)
 *   svelte-fast-check --raw              # raw output without filtering/mapping
 *   svelte-fast-check --no-svelte-warnings  # skip svelte compiler warnings
 *   svelte-fast-check --config ./svelte-fast-check.config.ts  # specify config file
 */

import { resolve } from 'path';
import { existsSync } from 'fs';
import { runFastCheck } from './index';
import type { FastCheckConfig } from './types';

async function main() {
  const args = process.argv.slice(2);

  // --incremental: enable incremental mode
  // without flag, defaults to non-incremental (clean mode)
  const incremental = args.includes('--incremental') || args.includes('-i');

  const rawMode = args.includes('--raw') || args.includes('-r');

  // --no-svelte-warnings: disable svelte compiler warnings
  const svelteWarnings = !args.includes('--no-svelte-warnings');

  // find config file
  const configIndex = args.findIndex((a) => a === '--config' || a === '-c');
  let configPath: string | undefined;
  const configArg = configIndex !== -1 ? args[configIndex + 1] : undefined;
  if (configArg) {
    configPath = resolve(process.cwd(), configArg);
  }

  // default config (SvelteKit project)
  let config: FastCheckConfig = {
    rootDir: process.cwd(),
    srcDir: resolve(process.cwd(), 'src'),
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
  const defaultConfigPath = resolve(process.cwd(), 'svelte-fast-check.config.ts');
  if (!configPath && existsSync(defaultConfigPath)) {
    try {
      const loaded = await import(defaultConfigPath);
      config = { ...config, ...loaded.default };
    } catch {
      // ignore config load failure
    }
  }

  const result = await runFastCheck(config, { incremental, raw: rawMode, svelteWarnings });

  // exit with code 1 if there are errors
  if (result.errorCount > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
