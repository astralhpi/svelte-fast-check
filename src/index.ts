/**
 * svelte-fast-check: Fast type checker alternative to svelte-check
 *
 * Fast type checking using svelte2tsx + tsgo
 */

export {
  collectAllSvelteWarnings,
  collectChangedSvelteWarnings,
} from "./compiler/collect";
export {
  formatDiagnostic,
  printDiagnostics,
  printRawDiagnostics,
  printSummary,
} from "./reporter";
// Re-export runner as main API
export {
  type RunOptions as FastCheckOptions,
  run as runFastCheck,
  type WarningFilter,
} from "./runner";
// Re-export utilities for advanced usage
export {
  buildSourcemapMap,
  convertAllSvelteFiles,
  convertChangedFiles,
  ensureCacheDir,
  generateTsconfig,
  getGeneratedTsconfigPath,
} from "./typecheck/convert";

export {
  extractTsxFiles,
  filterFalsePositives,
  loadTsxContents,
} from "./typecheck/filter";

export {
  filterNegativeLines,
  mapDiagnostics,
  tsxPathToOriginal,
} from "./typecheck/mapper";
export { countDiagnostics, parseTscOutput } from "./typecheck/parser";
// Public types
export type {
  CheckResult,
  ConversionResult,
  Diagnostic,
  FastCheckConfig,
  MappedDiagnostic,
  SourceMapData,
  SvelteWarning,
} from "./types";
