/**
 * Sourcemap-based location mapping module
 *
 * Converts error locations from .svelte.tsx files under .fast-check/tsx/
 * to original .svelte file locations under src/.
 */

import { resolve } from "node:path";
import { originalPositionFor, TraceMap } from "@jridgewell/trace-mapping";
import type { Diagnostic, MappedDiagnostic, SourceMapData } from "../types";

/** Default .fast-check folder path */
const DEFAULT_CACHE_ROOT = ".fast-check";
const TSX_DIR = "tsx";

/** Store getter function pattern from svelte2tsx */
const STORE_GET_PATTERN = "__sveltets_2_store_get(";

/** TS error code for store errors */
const TS_NO_OVERLOAD_MATCHES = 2769;

/**
 * Extract original svelte path from tsx path
 * .fast-check/tsx/src/routes/+layout.svelte.tsx -> src/routes/+layout.svelte
 *
 * @param rootDir - Project root directory
 * @param tsxPath - Path to .svelte.tsx file (relative or absolute)
 * @param cacheDir - Cache directory name (default: '.fast-check')
 */
export function tsxPathToOriginal(
  rootDir: string,
  tsxPath: string,
  cacheDir: string = DEFAULT_CACHE_ROOT,
): string {
  const cachePrefix = `${resolve(rootDir, cacheDir, TSX_DIR)}/`;

  if (tsxPath.startsWith(cachePrefix)) {
    // Absolute path case
    const relativeTsx = tsxPath.slice(cachePrefix.length);
    return relativeTsx.replace(/\.tsx$/, "");
  }

  // Relative path case (tsc output)
  const prefix = `${cacheDir}/${TSX_DIR}/`;
  if (tsxPath.startsWith(prefix)) {
    const relativeTsx = tsxPath.slice(prefix.length);
    return relativeTsx.replace(/\.tsx$/, "");
  }

  // Cannot convert
  return tsxPath.replace(/\.tsx$/, "");
}

/**
 * Map all diagnostics to original locations
 *
 * @param diagnostics - List of diagnostics to map
 * @param sourcemaps - Map of tsx file paths to sourcemap data
 * @param rootDir - Project root directory
 * @param tsxContents - Optional map of tsx file contents (for store error detection)
 * @param cacheDir - Cache directory name (default: '.fast-check')
 */
export function mapDiagnostics(
  diagnostics: Diagnostic[],
  sourcemaps: Map<string, SourceMapData>,
  rootDir: string,
  tsxContents?: Map<string, string>,
  cacheDir: string = DEFAULT_CACHE_ROOT,
): MappedDiagnostic[] {
  const mapped: MappedDiagnostic[] = [];

  for (const d of diagnostics) {
    const result = mapDiagnostic(d, sourcemaps, rootDir, tsxContents, cacheDir);
    if (result) {
      mapped.push(result);
    }
  }

  return mapped;
}

/**
 * Map a single diagnostic to original location
 */
function mapDiagnostic(
  d: Diagnostic,
  sourcemaps: Map<string, SourceMapData>,
  rootDir: string,
  tsxContents?: Map<string, string>,
  cacheDir: string = DEFAULT_CACHE_ROOT,
): MappedDiagnostic | null {
  // Only .svelte.tsx files need mapping
  if (!d.file.endsWith(".svelte.tsx")) {
    // Regular .ts files are returned as-is
    return {
      ...d,
      originalFile: d.file,
      originalLine: d.line,
      originalColumn: d.column,
    };
  }

  // Convert tsc output path to absolute path
  const absolutePath = resolve(rootDir, d.file);
  const sourcemap = sourcemaps.get(absolutePath);

  // Calculate original svelte path
  const originalFile = tsxPathToOriginal(rootDir, d.file, cacheDir);

  if (!sourcemap) {
    // Without sourcemap, original location is unknown
    return {
      ...d,
      originalFile,
      originalLine: d.line,
      originalColumn: d.column,
    };
  }

  try {
    // SourceMapData is compatible with TraceMap as returned by svelte2tsx
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tracer = new TraceMap(sourcemap as any);
    const original = originalPositionFor(tracer, {
      line: d.line,
      column: d.column - 1, // 0-based column
    });

    if (original.line === null || original.column === null) {
      // Mapping failed - likely generated code
      // For store errors (TS2769), try to find $store usage in nearby mapped range
      if (d.code === TS_NO_OVERLOAD_MATCHES && tsxContents) {
        const content = tsxContents.get(d.file);
        if (content) {
          const storeLocation = findStoreUsageLocation(content, d, tracer);
          if (storeLocation) {
            return {
              ...d,
              originalFile,
              originalLine: storeLocation.line,
              originalColumn: storeLocation.column,
              message: `Cannot use '${storeLocation.storeName}' as a store. '${storeLocation.storeName}' needs to be an object with a subscribe method on it.\n\n${d.message}`,
            };
          }
        }
      }
      return null;
    }

    return {
      ...d,
      originalFile,
      originalLine: original.line,
      originalColumn: original.column + 1, // 1-based column
    };
  } catch {
    // On mapping failure, return null (ignore this error)
    return null;
  }
}

/**
 * Filter out negative line numbers (mapping failure cases)
 */
export function filterNegativeLines(
  diagnostics: MappedDiagnostic[],
): MappedDiagnostic[] {
  return diagnostics.filter((d) => d.originalLine > 0 && d.originalColumn > 0);
}

/**
 * Find $store usage location for store errors
 *
 * When TS2769 occurs at __sveltets_2_store_get(storeName), we extract storeName
 * and find the $storeName usage location by searching nearby mapped positions.
 */
function findStoreUsageLocation(
  content: string,
  d: Diagnostic,
  tracer: TraceMap,
): { line: number; column: number; storeName: string } | null {
  const lines = content.split("\n");
  const errorLine = lines[d.line - 1];
  if (!errorLine) return null;

  // Extract store name from __sveltets_2_store_get(storeName)
  const storeGetIndex = errorLine.lastIndexOf(STORE_GET_PATTERN, d.column);
  if (storeGetIndex === -1) return null;

  const afterPattern = errorLine.slice(
    storeGetIndex + STORE_GET_PATTERN.length,
  );
  const storeNameMatch = afterPattern.match(/^(\w+)/);
  if (!storeNameMatch) return null;

  const storeName = storeNameMatch[1];
  const $storeName = `$${storeName}`;

  // Search for $storeName usage in lines after the declaration
  // Start from line after the error (store declaration is usually at top)
  // Skip occurrences in comments (// single-line or /* multi-line */)
  let inMultiLineComment = false;

  for (let lineIdx = d.line; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    if (!line) continue;

    // Track multi-line comment state
    let searchLine = line;
    let columnOffset = 0;

    // Handle multi-line comment continuation
    if (inMultiLineComment) {
      const endIdx = line.indexOf("*/");
      if (endIdx === -1) continue; // Still in comment
      inMultiLineComment = false;
      searchLine = line.slice(endIdx + 2);
      columnOffset = endIdx + 2;
    }

    // Skip single-line comments
    const singleCommentIdx = searchLine.indexOf("//");
    if (singleCommentIdx !== -1) {
      searchLine = searchLine.slice(0, singleCommentIdx);
    }

    // Handle multi-line comment start
    const multiStartIdx = searchLine.indexOf("/*");
    if (multiStartIdx !== -1) {
      const multiEndIdx = searchLine.indexOf("*/", multiStartIdx);
      if (multiEndIdx === -1) {
        // Comment continues to next line
        inMultiLineComment = true;
        searchLine = searchLine.slice(0, multiStartIdx);
      } else {
        // Comment ends on same line - remove it
        searchLine =
          searchLine.slice(0, multiStartIdx) +
          searchLine.slice(multiEndIdx + 2);
      }
    }

    // Search for $storeName in non-comment portion
    const $storeIndex = searchLine.indexOf($storeName);
    if ($storeIndex === -1) continue;

    // Verify it's not followed by word characters (exact match)
    const afterChar = searchLine[$storeIndex + $storeName.length];
    if (afterChar && /\w/.test(afterChar)) continue;

    // Try to map this position to original
    const mapped = originalPositionFor(tracer, {
      line: lineIdx + 1,
      column: columnOffset + $storeIndex,
    });

    if (mapped.line !== null && mapped.column !== null) {
      return { line: mapped.line, column: mapped.column + 1, storeName };
    }
  }

  return null;
}
