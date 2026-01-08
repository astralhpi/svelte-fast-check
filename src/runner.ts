/**
 * Worker orchestration
 *
 * Runs typecheck and compiler workers in parallel
 */

import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import type { CompilerInput, CompilerOutput } from "./compiler/worker";
import {
  printDiagnostics,
  printRawDiagnostics,
  printSummary,
} from "./reporter";
import { countDiagnostics } from "./typecheck/parser";
import type { TypeCheckInput, TypeCheckOutput } from "./typecheck/worker";
import type { CheckResult, FastCheckConfig, MappedDiagnostic } from "./types";

const require = createRequire(import.meta.url);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Svelte config structure (partial) */
interface SvelteConfig {
  compilerOptions?: {
    warningFilter?: WarningFilter;
  };
}

const SVELTE_CONFIG_FILES = [
  "svelte.config.js",
  "svelte.config.mjs",
  "svelte.config.ts",
];

/**
 * Load svelte.config.js from directory or specific path
 */
async function loadSvelteConfig(
  rootDirOrPath: string,
): Promise<SvelteConfig | null> {
  // Find config file if directory is given
  let configPath: string | undefined;
  if (SVELTE_CONFIG_FILES.some((f) => rootDirOrPath.endsWith(f))) {
    configPath = rootDirOrPath;
  } else {
    for (const filename of SVELTE_CONFIG_FILES) {
      const candidate = resolve(rootDirOrPath, filename);
      if (existsSync(candidate)) {
        configPath = candidate;
        break;
      }
    }
  }

  if (!configPath) return null;

  try {
    const fileUrl = pathToFileURL(configPath).href;
    const module = await import(fileUrl);
    return module.default as SvelteConfig;
  } catch {
    return null;
  }
}

/** Warning filter function type (same as svelte.config.js compilerOptions.warningFilter) */
export type WarningFilter = (warning: {
  code: string;
  message: string;
}) => boolean;

export interface RunOptions {
  /** Incremental mode (convert only changed files) */
  incremental?: boolean;
  /** Raw mode (output without filtering/mapping) */
  raw?: boolean;
  /** Quiet mode (suppress progress output) */
  quiet?: boolean;
  /** Enable svelte compiler warnings (default: true) */
  svelteWarnings?: boolean;
  /** Use svelte.config.js for warningFilter (default: true) */
  useSvelteConfig?: boolean;
  /** Custom path to svelte.config.js (auto-detected if not specified) */
  svelteConfigPath?: string;
  /** Custom warning filter function (takes precedence over svelte.config.js) */
  warningFilter?: WarningFilter;
}

/**
 * Get worker file path (supports both dev and built environments)
 */
function getWorkerPath(pipeline: "typecheck" | "compiler"): string {
  // In development: src/typecheck/worker.ts
  // After build: dist/typecheck/worker.js
  const jsPath = resolve(__dirname, `${pipeline}/worker.js`);
  const tsPath = resolve(__dirname, `${pipeline}/worker.ts`);

  // Prefer .js (built) if exists, otherwise .ts (dev)
  try {
    require.resolve(jsPath);
    return jsPath;
  } catch {
    return tsPath;
  }
}

/**
 * Run a worker and return its result
 */
function runWorker<TInput, TOutput>(
  workerPath: string,
  input: TInput,
): Promise<TOutput> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerPath);

    worker.on("message", (result: TOutput) => {
      worker.terminate();
      resolve(result);
    });

    worker.on("error", (error) => {
      worker.terminate();
      reject(error);
    });

    worker.on("exit", (code) => {
      if (code !== 0) {
        reject(new Error(`Worker stopped with exit code ${code}`));
      }
    });

    worker.postMessage(input);
  });
}

/**
 * Run svelte-fast-check
 */
export async function run(
  config: FastCheckConfig,
  options: RunOptions = {},
): Promise<CheckResult> {
  const {
    incremental = false,
    raw = false,
    quiet = false,
    svelteWarnings = true,
    useSvelteConfig = true,
    svelteConfigPath,
    warningFilter: customWarningFilter,
  } = options;
  const startTime = performance.now();

  const log = quiet ? () => {} : console.log.bind(console);

  log("🔍 svelte-fast-check: Starting type check...\n");

  // Load warning filter from svelte.config.js (if enabled)
  let warningFilter: WarningFilter | undefined = customWarningFilter;

  if (!warningFilter && useSvelteConfig && svelteWarnings) {
    const svelteConfig = await loadSvelteConfig(
      svelteConfigPath ?? config.rootDir,
    );
    warningFilter = svelteConfig?.compilerOptions?.warningFilter;
  }

  // Resolve worker paths
  const typeCheckWorkerPath = getWorkerPath("typecheck");
  const compilerWorkerPath = getWorkerPath("compiler");

  // Prepare worker inputs
  const typeCheckInput: TypeCheckInput = { config, incremental, raw };
  const compilerInput: CompilerInput = { config, incremental };

  // Run workers in parallel
  // In raw mode, skip compiler worker (only typecheck needed for debugging)
  const runCompilerWorker = svelteWarnings && !raw;

  const [typeCheckResult, compilerResult] = await Promise.all([
    runWorker<TypeCheckInput, TypeCheckOutput>(
      typeCheckWorkerPath,
      typeCheckInput,
    ),
    runCompilerWorker
      ? runWorker<CompilerInput, CompilerOutput>(
          compilerWorkerPath,
          compilerInput,
        )
      : null,
  ]);

  const totalTime = Math.round(performance.now() - startTime);

  // Check for worker errors
  if (typeCheckResult.error) {
    throw new Error(`TypeCheck worker failed: ${typeCheckResult.error}`);
  }
  if (compilerResult?.error) {
    throw new Error(`Compiler worker failed: ${compilerResult.error}`);
  }

  if (raw) {
    // Raw mode: only typecheck, no svelte warnings, no filter/map
    const diagnostics = typeCheckResult.diagnostics;
    const { errorCount, warningCount } = countDiagnostics(diagnostics);

    if (!quiet && diagnostics.length > 0) {
      log("📋 Diagnostics (raw):\n");
      printRawDiagnostics(diagnostics);
      log();
    }

    if (!quiet) {
      log("─".repeat(60));
      if (errorCount === 0 && warningCount === 0) {
        log("✅ No problems found");
      } else {
        const parts: string[] = [];
        if (errorCount > 0) parts.push(`${errorCount} error(s)`);
        if (warningCount > 0) parts.push(`${warningCount} warning(s)`);
        log(`❌ Found ${parts.join(" and ")}`);
      }
      log(`⏱️  Total time: ${totalTime}ms`);
    }

    return {
      diagnostics,
      errorCount,
      warningCount,
      duration: totalTime,
    };
  }

  // Merge diagnostics from both workers
  let allDiagnostics = [
    ...typeCheckResult.diagnostics,
    ...(compilerResult?.diagnostics ?? []),
  ];

  // Apply warning filter (post-processing, only for svelte warnings)
  if (warningFilter) {
    allDiagnostics = allDiagnostics.filter(
      (d) =>
        d.source !== "svelte" ||
        !d.svelteCode ||
        warningFilter({ code: d.svelteCode, message: d.message }),
    );
  }

  const { errorCount, warningCount } = countDiagnostics(allDiagnostics);

  const result: CheckResult = {
    diagnostics: allDiagnostics,
    errorCount,
    warningCount,
    duration: totalTime,
  };

  if (!quiet) {
    if (allDiagnostics.length > 0) {
      log("📋 Diagnostics:\n");
      printDiagnostics(allDiagnostics, config.rootDir);
    }

    printSummary(result);
    log(
      `   (typeCheck: ${typeCheckResult.duration}ms, svelteWarnings: ${compilerResult?.duration ?? 0}ms)`,
    );
  }

  return result;
}
