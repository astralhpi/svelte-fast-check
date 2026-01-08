/**
 * Svelte compiler warnings module
 *
 * Collects warnings from svelte.compile({ generate: false })
 * Runs in parallel with the type checking pipeline.
 */

import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { compile } from "svelte/compiler";
import { findSvelteFiles } from "../typecheck/convert";
import type {
  FastCheckConfig,
  MappedDiagnostic,
  SvelteWarning,
} from "../types";

/** Cache directory for warnings */
const WARNINGS_DIR = "warnings";

/** Get warnings cache path for a source file */
function getWarningsCachePath(
  config: FastCheckConfig,
  sourcePath: string,
): string {
  const cacheRoot = config.cacheDir || ".fast-check";
  const relativePath = relative(config.rootDir, sourcePath);
  const safeName = relativePath.replace(/[/\\]/g, "_");
  return resolve(config.rootDir, cacheRoot, WARNINGS_DIR, `${safeName}.json`);
}

/** Ensure warnings cache directory exists */
function ensureWarningsCacheDir(config: FastCheckConfig): void {
  const cacheRoot = config.cacheDir || ".fast-check";
  const warningsDir = resolve(config.rootDir, cacheRoot, WARNINGS_DIR);

  if (!existsSync(warningsDir)) {
    mkdirSync(warningsDir, { recursive: true });
  }
}

/** Cached warning data */
interface CachedWarnings {
  mtime: number;
  warnings: SvelteWarning[];
}

/**
 * Get svelte compiler warnings for a single file
 */
function getSvelteWarnings(filePath: string, content: string): SvelteWarning[] {
  try {
    const result = compile(content, {
      filename: filePath,
      generate: false,
    });
    return result.warnings as SvelteWarning[];
  } catch {
    // Compilation error - return empty (type errors are caught by tsgo)
    return [];
  }
}

/**
 * Convert SvelteWarning to MappedDiagnostic
 */
function warningToDiagnostic(
  warning: SvelteWarning,
  rootDir: string,
): MappedDiagnostic {
  const relativePath = warning.filename.startsWith(rootDir)
    ? relative(rootDir, warning.filename)
    : warning.filename;

  // Svelte compiler returns 0-based columns, convert to 1-based for consistency with tsc
  const column = warning.start.column + 1;

  return {
    file: relativePath,
    line: warning.start.line,
    column,
    code: 0, // Svelte warnings don't have numeric codes
    message: warning.message,
    severity: "warning",
    source: "svelte",
    originalFile: relativePath,
    originalLine: warning.start.line,
    originalColumn: column,
    svelteCode: warning.code,
  };
}

/**
 * Collect warnings from all svelte files (parallel)
 */
export async function collectAllSvelteWarnings(
  config: FastCheckConfig,
): Promise<MappedDiagnostic[]> {
  const files = await findSvelteFiles(config);
  const diagnostics: MappedDiagnostic[] = [];

  const results = await Promise.all(
    files.map(async (file) => {
      const sourcePath = resolve(config.rootDir, file);
      const content = await readFile(sourcePath, "utf-8");
      const warnings = getSvelteWarnings(sourcePath, content);
      return warnings.map((w) => warningToDiagnostic(w, config.rootDir));
    }),
  );

  for (const result of results) {
    diagnostics.push(...result);
  }

  return diagnostics;
}

/**
 * Collect warnings with incremental caching (only process changed files)
 */
export async function collectChangedSvelteWarnings(
  config: FastCheckConfig,
): Promise<MappedDiagnostic[]> {
  ensureWarningsCacheDir(config);

  const files = await findSvelteFiles(config);
  const diagnostics: MappedDiagnostic[] = [];

  const results = await Promise.all(
    files.map(async (file) => {
      const sourcePath = resolve(config.rootDir, file);
      const cachePath = getWarningsCachePath(config, sourcePath);

      // Check if cache is valid
      if (existsSync(cachePath) && existsSync(sourcePath)) {
        const sourceStat = statSync(sourcePath);
        const sourceMtime = sourceStat.mtime.getTime();

        try {
          const cached: CachedWarnings = JSON.parse(
            readFileSync(cachePath, "utf-8"),
          );
          if (cached.mtime >= sourceMtime) {
            // Cache is valid, use cached warnings
            return cached.warnings.map((w) =>
              warningToDiagnostic(w, config.rootDir),
            );
          }
        } catch {
          // Invalid cache, recompile
        }
      }

      // Compile and cache
      const content = await readFile(sourcePath, "utf-8");
      const warnings = getSvelteWarnings(sourcePath, content);

      // Save to cache (store source file's mtime)
      const cacheData: CachedWarnings = {
        mtime: statSync(sourcePath).mtime.getTime(),
        warnings,
      };

      // Create cache directory (ignore EEXIST for race condition with Promise.all)
      const cacheDir = dirname(cachePath);
      await mkdir(cacheDir, { recursive: true }).catch(() => {});
      await writeFile(cachePath, JSON.stringify(cacheData));

      return warnings.map((w) => warningToDiagnostic(w, config.rootDir));
    }),
  );

  for (const result of results) {
    diagnostics.push(...result);
  }

  return diagnostics;
}
