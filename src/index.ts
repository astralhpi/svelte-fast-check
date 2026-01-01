/**
 * svelte-fast-check: Fast type checker alternative to svelte-check
 *
 * Fast type checking using svelte2tsx + tsgo
 */

export type {
  FastCheckConfig,
  CheckResult,
  Diagnostic,
  MappedDiagnostic,
  ConversionResult,
  SourceMapData,
} from './types';

export {
  convertAllSvelteFiles,
  convertChangedFiles,
  buildSourcemapMap,
  generateTsconfig,
  getGeneratedTsconfigPath,
  ensureCacheDir,
} from './convert';

export { parseTscOutput, countDiagnostics } from './parser';

export { filterFalsePositives, loadTsxContents, extractTsxFiles } from './filter';

export { mapDiagnostics, filterNegativeLines, tsxPathToOriginal } from './mapper';

export { formatDiagnostic, printDiagnostics, printSummary, printRawDiagnostics } from './reporter';

import { spawnSync } from 'child_process';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

function getTsgoPath(): string {
  try {
    // Find tsgo binary path from @typescript/native-preview package
    const nativePreviewPath = require.resolve('@typescript/native-preview/package.json');
    const packageDir = nativePreviewPath.replace('/package.json', '');
    return `${packageDir}/bin/tsgo.js`;
  } catch {
    // fallback: find tsgo in PATH
    return 'tsgo';
  }
}
import type { FastCheckConfig, CheckResult } from './types';
import {
  convertAllSvelteFiles,
  convertChangedFiles,
  buildSourcemapMap,
  generateTsconfig,
} from './convert';
import { parseTscOutput, countDiagnostics } from './parser';
import { filterFalsePositives, loadTsxContents, extractTsxFiles } from './filter';
import { mapDiagnostics, filterNegativeLines } from './mapper';
import { printDiagnostics, printSummary, printRawDiagnostics } from './reporter';

export interface FastCheckOptions {
  /** Incremental mode (convert only changed files) */
  incremental?: boolean;
  /** Raw mode (output without filtering/mapping) */
  raw?: boolean;
  /** Quiet mode (suppress progress output) */
  quiet?: boolean;
}

/**
 * Run svelte-fast-check
 */
export async function runFastCheck(
  config: FastCheckConfig,
  options: FastCheckOptions = {}
): Promise<CheckResult> {
  const { incremental = false, raw = false, quiet = false } = options;
  const startTime = performance.now();

  const log = quiet ? () => {} : console.log.bind(console);

  log('🔍 svelte-fast-check: Starting type check (tsgo)...\n');

  // Step 1: svelte2tsx conversion
  log('📦 Step 1: Converting .svelte to .svelte.tsx...');
  const convertStart = performance.now();

  const results = incremental
    ? await convertChangedFiles(config)
    : await convertAllSvelteFiles(config);

  const convertTime = Math.round(performance.now() - convertStart);
  log(`   Done in ${convertTime}ms\n`);

  // Warn if some files failed to convert
  const failed = results.filter((r) => !r.success);
  if (failed.length > 0 && !quiet) {
    log(`⚠️  ${failed.length} file(s) failed to convert:`);
    for (const f of failed) {
      log(`   - ${f.sourcePath}: ${f.error}`);
    }
    log();
  }

  // Step 2: Generate dynamic tsconfig & run tsgo
  log('🔎 Step 2: Running tsgo type check...');
  const tscStart = performance.now();

  const tsconfigPath = await generateTsconfig(config, { incremental });
  const tsgoPath = getTsgoPath();
  const tscResult = spawnSync('node', [tsgoPath, '--noEmit', '-p', tsconfigPath], {
    cwd: config.rootDir,
    encoding: 'utf-8',
  });

  const tscTime = Math.round(performance.now() - tscStart);
  log(`   Done in ${tscTime}ms\n`);

  // Step 3: Parse results
  if (tscResult.error) {
    throw new Error(`tsgo execution failed: ${tscResult.error.message}`);
  }
  const output = (tscResult.stdout ?? '') + (tscResult.stderr ?? '');
  let diagnostics = parseTscOutput(output);

  if (raw) {
    // Raw mode: output without filtering/mapping
    const { errorCount, warningCount } = countDiagnostics(diagnostics);
    const totalTime = Math.round(performance.now() - startTime);

    if (!quiet && diagnostics.length > 0) {
      log('📋 Diagnostics (raw):\n');
      printRawDiagnostics(diagnostics);
      log();
    }

    if (!quiet) {
      log('─'.repeat(60));
      if (errorCount === 0 && warningCount === 0) {
        log('✅ No problems found');
      } else {
        const parts: string[] = [];
        if (errorCount > 0) parts.push(`${errorCount} error(s)`);
        if (warningCount > 0) parts.push(`${warningCount} warning(s)`);
        log(`❌ Found ${parts.join(' and ')}`);
      }
      log(`⏱️  Total time: ${totalTime}ms (convert: ${convertTime}ms, tsc: ${tscTime}ms)`);
    }

    return {
      diagnostics: diagnostics.map((d) => ({
        ...d,
        originalFile: d.file,
        originalLine: d.line,
        originalColumn: d.column,
      })),
      errorCount,
      warningCount,
      duration: totalTime,
    };
  }

  // Step 4: Filter false positives
  log('🔧 Step 3: Filtering false positives...');
  const filterStart = performance.now();

  const tsxFiles = extractTsxFiles(diagnostics);
  const tsxContents = loadTsxContents(tsxFiles, config.rootDir);
  diagnostics = filterFalsePositives(diagnostics, tsxContents);

  const filterTime = Math.round(performance.now() - filterStart);
  log(`   Done in ${filterTime}ms\n`);

  // Step 5: Sourcemap mapping
  log('🗺️  Step 4: Mapping to original locations...');
  const mapStart = performance.now();

  const sourcemaps = buildSourcemapMap(results);
  let mapped = mapDiagnostics(diagnostics, sourcemaps, config.rootDir, tsxContents);
  mapped = filterNegativeLines(mapped);

  const mapTime = Math.round(performance.now() - mapStart);
  log(`   Done in ${mapTime}ms\n`);

  // Step 6: Output results
  const { errorCount, warningCount } = countDiagnostics(mapped);
  const totalTime = Math.round(performance.now() - startTime);

  const result: CheckResult = {
    diagnostics: mapped,
    errorCount,
    warningCount,
    duration: totalTime,
  };

  if (!quiet) {
    if (mapped.length > 0) {
      log('📋 Diagnostics:\n');
      printDiagnostics(mapped, config.rootDir);
    }

    printSummary(result);
    log(
      `   (convert: ${convertTime}ms, tsgo: ${tscTime}ms, filter: ${filterTime}ms, map: ${mapTime}ms)`
    );
  }

  return result;
}
