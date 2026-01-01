/**
 * Svelte compiler warnings module
 *
 * Collects warnings from svelte.compile({ generate: false })
 * Runs in parallel with the type checking pipeline.
 */

import { compile } from 'svelte/compiler';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync, statSync, readFileSync } from 'fs';
import { resolve, dirname, relative } from 'path';
import { globSync } from 'glob';
import type { FastCheckConfig, MappedDiagnostic, SvelteWarning } from './types';

/** Cache directory for warnings */
const WARNINGS_DIR = 'warnings';

/** Get warnings cache path for a source file */
function getWarningsCachePath(config: FastCheckConfig, sourcePath: string): string {
  const cacheRoot = config.cacheDir || '.fast-check';
  const relativePath = relative(config.rootDir, sourcePath);
  const safeName = relativePath.replace(/[/\\]/g, '_');
  return resolve(config.rootDir, cacheRoot, WARNINGS_DIR, safeName + '.json');
}

/** Ensure warnings cache directory exists */
function ensureWarningsCacheDir(config: FastCheckConfig): void {
  const cacheRoot = config.cacheDir || '.fast-check';
  const warningsDir = resolve(config.rootDir, cacheRoot, WARNINGS_DIR);

  if (!existsSync(warningsDir)) {
    require('fs').mkdirSync(warningsDir, { recursive: true });
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
function warningToDiagnostic(warning: SvelteWarning, rootDir: string): MappedDiagnostic {
  const relativePath = warning.filename.startsWith(rootDir)
    ? relative(rootDir, warning.filename)
    : warning.filename;

  return {
    file: relativePath,
    line: warning.start.line,
    column: warning.start.column,
    code: 0, // Svelte warnings don't have numeric codes
    message: warning.message,
    severity: 'warning',
    source: 'svelte',
    originalFile: relativePath,
    originalLine: warning.start.line,
    originalColumn: warning.start.column,
  };
}

/**
 * Collect warnings from all svelte files (parallel)
 */
export async function collectAllSvelteWarnings(
  config: FastCheckConfig
): Promise<MappedDiagnostic[]> {
  const files = globSync('**/*.svelte', { cwd: config.srcDir });
  const diagnostics: MappedDiagnostic[] = [];

  const results = await Promise.all(
    files.map(async (file) => {
      const sourcePath = resolve(config.srcDir, file);
      const content = await readFile(sourcePath, 'utf-8');
      const warnings = getSvelteWarnings(sourcePath, content);
      return warnings.map((w) => warningToDiagnostic(w, config.rootDir));
    })
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
  config: FastCheckConfig
): Promise<MappedDiagnostic[]> {
  ensureWarningsCacheDir(config);

  const files = globSync('**/*.svelte', { cwd: config.srcDir });
  const diagnostics: MappedDiagnostic[] = [];

  const results = await Promise.all(
    files.map(async (file) => {
      const sourcePath = resolve(config.srcDir, file);
      const cachePath = getWarningsCachePath(config, sourcePath);

      // Check if cache is valid
      if (existsSync(cachePath) && existsSync(sourcePath)) {
        const sourceStat = statSync(sourcePath);
        const sourceMtime = sourceStat.mtime.getTime();

        try {
          const cached: CachedWarnings = JSON.parse(readFileSync(cachePath, 'utf-8'));
          if (cached.mtime >= sourceMtime) {
            // Cache is valid, use cached warnings
            return cached.warnings.map((w) => warningToDiagnostic(w, config.rootDir));
          }
        } catch {
          // Invalid cache, recompile
        }
      }

      // Compile and cache
      const content = await readFile(sourcePath, 'utf-8');
      const warnings = getSvelteWarnings(sourcePath, content);

      // Save to cache (store source file's mtime)
      const cacheData: CachedWarnings = {
        mtime: statSync(sourcePath).mtime.getTime(),
        warnings,
      };
      
      const cacheDir = dirname(cachePath);
      if (!existsSync(cacheDir)) {
        await mkdir(cacheDir, { recursive: true });
      }
      await writeFile(cachePath, JSON.stringify(cacheData));

      return warnings.map((w) => warningToDiagnostic(w, config.rootDir));
    })
  );

  for (const result of results) {
    diagnostics.push(...result);
  }

  return diagnostics;
}
