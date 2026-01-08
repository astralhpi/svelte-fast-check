/**
 * Common type definitions for svelte-fast-check
 */

/** svelte2tsx SourceMap type (mappings is string) */
export interface Svelte2TsxSourceMap {
  mappings: string;
  names: string[];
  sources: string[];
  version: number;
}

/** Map type used in ConversionResult */
export type SourceMapData =
  | Svelte2TsxSourceMap
  | { mappings: string; sources: never[] };

/** svelte2tsx conversion result */
export interface ConversionResult {
  /** Original .svelte file path */
  sourcePath: string;
  /** Generated .svelte.tsx file path */
  outputPath: string;
  /** Sourcemap data */
  map: SourceMapData;
  /** Whether conversion succeeded */
  success: boolean;
  /** Error message (on failure) */
  error?: string;
}

/** TypeScript diagnostic (tsgo output) */
export interface Diagnostic {
  /** File path (.svelte.tsx) */
  file: string;
  /** 1-based line number */
  line: number;
  /** 1-based column number */
  column: number;
  /** TS error code (e.g., 2304), 0 for svelte warnings */
  code: number;
  /** Error message */
  message: string;
  /** Severity */
  severity: "error" | "warning";
  /** Source of the diagnostic */
  source?: "ts" | "svelte";
}

/** Mapped diagnostic (original .svelte location) */
export interface MappedDiagnostic extends Diagnostic {
  /** Original .svelte file path */
  originalFile: string;
  /** Original 1-based line number */
  originalLine: number;
  /** Original 1-based column number */
  originalColumn: number;
  /** Svelte warning code (e.g., 'state_referenced_locally') - only for svelte warnings */
  svelteCode?: string;
}

/** Svelte compiler warning (from svelte.compile) */
export interface SvelteWarning {
  /** Warning code (e.g., 'state_referenced_locally') */
  code: string;
  /** Warning message */
  message: string;
  /** File path */
  filename: string;
  /** Start position */
  start: {
    line: number;
    column: number;
    character: number;
  };
  /** End position */
  end: {
    line: number;
    column: number;
    character: number;
  };
  /** Code frame */
  frame?: string;
}

/** svelte-fast-check execution result */
export interface CheckResult {
  /** List of diagnostics */
  diagnostics: MappedDiagnostic[];
  /** Error count */
  errorCount: number;
  /** Warning count */
  warningCount: number;
  /** Execution time (ms) */
  duration: number;
}

/** svelte-fast-check configuration */
export interface FastCheckConfig {
  /** Project root directory */
  rootDir: string;
  /** Source directory (where svelte files are located) */
  srcDir: string;
  /** Cache directory name (default: .fast-check) */
  cacheDir?: string;
  /** tsconfig path aliases */
  paths?: Record<string, string[]>;
  /** File patterns to exclude */
  exclude?: string[];
  /** Additional file patterns to include */
  include?: string[];
  /** SvelteKit types directory */
  svelteKitTypesDir?: string;
  /** @types packages to include (empty array disables auto-loading) */
  types?: string[];
}

/** Common worker output */
export interface WorkerOutput {
  diagnostics: MappedDiagnostic[];
  duration: number;
  error?: string;
}
