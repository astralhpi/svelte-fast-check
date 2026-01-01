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
  SvelteWarning,
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

export { collectAllSvelteWarnings, collectChangedSvelteWarnings } from './compiler';

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
import type { FastCheckConfig, CheckResult, MappedDiagnostic } from './types';
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
import { collectAllSvelteWarnings, collectChangedSvelteWarnings } from './compiler';

export interface FastCheckOptions {
  /** Incremental mode (convert only changed files) */
  incremental?: boolean;
  /** Raw mode (output without filtering/mapping) */
  raw?: boolean;
  /** Quiet mode (suppress progress output) */
  quiet?: boolean;
  /** Enable svelte compiler warnings (default: true) */
  svelteWarnings?: boolean;
}

/**
 * Run svelte-fast-check
 */
export async function runFastCheck(
  config: FastCheckConfig,
  options: FastCheckOptions = {}
): Promise<CheckResult> {
  const { incremental = false, raw = false, quiet = false, svelteWarnings = true } = options;
  const startTime = performance.now();

  const log = quiet ? () => {} : console.log.bind(console);

  log('🔍 svelte-fast-check: Starting type check...\n');

  // Run both pipelines in parallel
  const [typeCheckResult, svelteWarningsResult] = await Promise.all([
    // Pipeline 1: Type checking (svelte2tsx -> tsgo)
    runTypeCheckPipeline(config, { incremental, raw, quiet }),
    // Pipeline 2: Svelte compiler warnings
    svelteWarnings
      ? runSvelteWarningsPipeline(config, { incremental, quiet })
      : Promise.resolve({ diagnostics: [], duration: 0 }),
  ]);

  const totalTime = Math.round(performance.now() - startTime);

  if (raw) {
    // Raw mode: output without filtering/mapping
    const diagnostics = typeCheckResult.diagnostics;
    const { errorCount, warningCount } = countDiagnostics(diagnostics);

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
      log(`⏱️  Total time: ${totalTime}ms`);
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

  // Merge diagnostics from both pipelines
  const allDiagnostics = [
    ...typeCheckResult.diagnostics,
    ...svelteWarningsResult.diagnostics,
  ];

  const { errorCount, warningCount } = countDiagnostics(allDiagnostics);

  const result: CheckResult = {
    diagnostics: allDiagnostics,
    errorCount,
    warningCount,
    duration: totalTime,
  };

  if (!quiet) {
    if (allDiagnostics.length > 0) {
      log('📋 Diagnostics:\n');
      printDiagnostics(allDiagnostics, config.rootDir);
    }

    printSummary(result);
    log(
      `   (typeCheck: ${typeCheckResult.duration}ms, svelteWarnings: ${svelteWarningsResult.duration}ms)`
    );
  }

  return result;
}

interface PipelineResult {
  diagnostics: MappedDiagnostic[];
  duration: number;
}

/**
 * Pipeline 1: Type checking with svelte2tsx + tsgo
 */
async function runTypeCheckPipeline(
  config: FastCheckConfig,
  options: { incremental: boolean; raw: boolean; quiet: boolean }
): Promise<PipelineResult> {
  const { incremental, raw, quiet } = options;
  const startTime = performance.now();
  const log = quiet ? () => {} : console.log.bind(console);

  // Step 1: svelte2tsx conversion
  log('📦 Converting .svelte to .svelte.tsx...');
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
  log('🔎 Running tsgo type check...');
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

  // Add source marker
  diagnostics = diagnostics.map((d) => ({ ...d, source: 'ts' as const }));

  if (raw) {
    return {
      diagnostics: diagnostics as unknown as MappedDiagnostic[],
      duration: Math.round(performance.now() - startTime),
    };
  }

  // Step 4: Filter false positives
  log('🔧 Filtering false positives...');
  const filterStart = performance.now();

  const tsxFiles = extractTsxFiles(diagnostics);
  const tsxContents = loadTsxContents(tsxFiles, config.rootDir);
  diagnostics = filterFalsePositives(diagnostics, tsxContents);

  const filterTime = Math.round(performance.now() - filterStart);
  log(`   Done in ${filterTime}ms\n`);

  // Step 5: Sourcemap mapping
  log('🗺️  Mapping to original locations...');
  const mapStart = performance.now();

  const sourcemaps = buildSourcemapMap(results);
  let mapped = mapDiagnostics(diagnostics, sourcemaps, config.rootDir, tsxContents);
  mapped = filterNegativeLines(mapped);

  const mapTime = Math.round(performance.now() - mapStart);
  log(`   Done in ${mapTime}ms\n`);

  return {
    diagnostics: mapped,
    duration: Math.round(performance.now() - startTime),
  };
}

/**
 * Pipeline 2: Svelte compiler warnings
 */
async function runSvelteWarningsPipeline(
  config: FastCheckConfig,
  options: { incremental: boolean; quiet: boolean }
): Promise<PipelineResult> {
  const { incremental, quiet } = options;
  const startTime = performance.now();
  const log = quiet ? () => {} : console.log.bind(console);

  log('⚡ Collecting svelte compiler warnings...');

  const diagnostics = incremental
    ? await collectChangedSvelteWarnings(config)
    : await collectAllSvelteWarnings(config);

  const duration = Math.round(performance.now() - startTime);
  log(`   Done in ${duration}ms\n`);

  return { diagnostics, duration };
}
