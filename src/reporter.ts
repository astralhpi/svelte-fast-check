/**
 * Error output formatting module
 */

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import type { Diagnostic, MappedDiagnostic, CheckResult } from './types';

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
  bold: '\x1b[1m',
};

// Source file cache
const sourceCache = new Map<string, string[]>();

/**
 * Get lines from source file (cached)
 */
function getSourceLines(filePath: string, rootDir: string): string[] | null {
  if (sourceCache.has(filePath)) {
    return sourceCache.get(filePath)!;
  }

  const absolutePath = resolve(rootDir, filePath);
  if (!existsSync(absolutePath)) {
    return null;
  }

  try {
    const content = readFileSync(absolutePath, 'utf-8');
    const lines = content.split('\n');
    sourceCache.set(filePath, lines);
    return lines;
  } catch {
    return null;
  }
}

/**
 * Generate code snippet around error location (svelte-check style + column caret)
 */
function getCodeSnippet(
  filePath: string,
  line: number,
  column: number,
  rootDir: string
): string | null {
  const lines = getSourceLines(filePath, rootDir);
  if (!lines) return null;

  const lineIndex = line - 1;
  if (lineIndex < 0 || lineIndex >= lines.length) return null;

  const result: string[] = [];

  // Previous line (if exists)
  if (lineIndex > 0) {
    result.push(`${colors.gray}  ${lines[lineIndex - 1]}${colors.reset}`);
  }

  // Error line (highlighted)
  const errorLine = lines[lineIndex];
  result.push(`${colors.red}> ${errorLine}${colors.reset}`);

  // Error position caret
  const caretPadding = ' '.repeat(column + 1); // +2 for "> ", -1 for 1-based
  result.push(`${colors.red}${caretPadding}^${colors.reset}`);

  return result.join('\n');
}

/**
 * Format diagnostic in svelte-check style
 *
 * Output format:
 * /path/to/file.svelte:10:5
 * Error: Cannot find name 'foo'. (ts)
 *   let x: string = 123;
 * >       ^
 *
 * For svelte warnings:
 * /path/to/file.svelte:10:5
 * Warning: This reference only captures... (svelte)
 */
export function formatDiagnostic(d: MappedDiagnostic, rootDir: string): string {
  const location = `${colors.cyan}${d.originalFile}:${d.originalLine}:${d.originalColumn}${colors.reset}`;
  const severity =
    d.severity === 'error'
      ? `${colors.red}${colors.bold}Error${colors.reset}`
      : `${colors.yellow}Warning${colors.reset}`;

  // Format code based on source
  const code =
    d.source === 'svelte'
      ? `${colors.gray}(svelte)${colors.reset}`
      : `${colors.gray}(ts${d.code})${colors.reset}`;

  const header = `${location}\n${severity}: ${d.message} ${code}`;

  // Add code snippet
  const snippet = getCodeSnippet(d.originalFile, d.originalLine, d.originalColumn, rootDir);
  if (snippet) {
    return `${header}\n${snippet}`;
  }

  return header;
}

/**
 * Print all diagnostics
 */
export function printDiagnostics(diagnostics: MappedDiagnostic[], rootDir: string): void {
  // Group by file
  const byFile = new Map<string, MappedDiagnostic[]>();
  for (const d of diagnostics) {
    const file = d.originalFile;
    if (!byFile.has(file)) {
      byFile.set(file, []);
    }
    byFile.get(file)!.push(d);
  }

  // Print by file
  for (const [, fileDiagnostics] of byFile) {
    // Sort by line number
    fileDiagnostics.sort((a, b) => a.originalLine - b.originalLine);

    for (const d of fileDiagnostics) {
      console.log(formatDiagnostic(d, rootDir));
      console.log();
    }
  }
}

/**
 * Print summary
 */
export function printSummary(result: CheckResult): void {
  const { errorCount, warningCount, duration } = result;

  console.log('─'.repeat(60));

  if (errorCount === 0 && warningCount === 0) {
    console.log(`${colors.cyan}✓${colors.reset} No problems found`);
  } else {
    const parts: string[] = [];
    if (errorCount > 0) {
      parts.push(`${colors.red}${errorCount} error(s)${colors.reset}`);
    }
    if (warningCount > 0) {
      parts.push(`${colors.yellow}${warningCount} warning(s)${colors.reset}`);
    }
    console.log(`Found ${parts.join(' and ')}`);
  }

  console.log(`${colors.gray}Completed in ${duration}ms${colors.reset}`);
}

/**
 * Print raw diagnostics (for Phase 1)
 */
export function printRawDiagnostics(diagnostics: Diagnostic[]): void {
  for (const d of diagnostics) {
    const severity = d.severity === 'error' ? 'Error' : 'Warning';
    console.log(`${d.file}(${d.line},${d.column}): ${severity} TS${d.code}: ${d.message}`);
  }
}
