/**
 * False positive filtering module
 *
 * Ported from svelte-check's DiagnosticsProvider logic
 * to filter false positives from svelte2tsx generated code.
 */

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import type { Diagnostic } from './types';

/** TS error codes to filter */
const DiagnosticCode = {
  // Filter targets
  USED_BEFORE_ASSIGNED: 2454, // export let x pattern
  UNUSED_LABEL: 7028, // $: reactive statement
  DEPRECATED_SIGNATURE: 6387, // $$_ generated variables

  // Conditional filtering (Element attributes)
  DUPLICATE_IDENTIFIER: 2300,
  MULTIPLE_PROPS_SAME_NAME: 1117,

  // JSX related (ignore in svelte components)
  DUPLICATED_JSX_ATTRIBUTES: 17001,

  // bind:this related - svelte2tsx infers component instance as SvelteComponent
  PROPERTY_MISSING: 2741,

  // Store related - should NOT be filtered even in ignore regions
  NO_OVERLOAD_MATCHES_CALL: 2769, // Invalid store usage (e.g., $page instead of page)
} as const;

/** Generated variable pattern (Svelte 5 internal variables) */
const generatedVarRegex = /'\$\$_\w+(\.\$on)?'/;

/** Ignore region markers */
const IGNORE_START = '/*Ωignore_startΩ*/';
const IGNORE_END = '/*Ωignore_endΩ*/';

/** Store getter function pattern from svelte2tsx */
const STORE_GET_PATTERN = '__sveltets_2_store_get(';

/**
 * Apply all filtering rules to remove false positives
 */
export function filterFalsePositives(
  diagnostics: Diagnostic[],
  tsxContents: Map<string, string>
): Diagnostic[] {
  return diagnostics.filter((d) => {
    const content = tsxContents.get(d.file);
    if (!content) return true; // Can't filter without content, keep it

    // 1. Ignore errors inside ignore regions
    // Exception: Store-related errors (TS2769) should be kept even in ignore regions
    if (isInGeneratedCode(content, d)) {
      // Check if this is a store-related error that should be preserved
      if (d.code === DiagnosticCode.NO_OVERLOAD_MATCHES_CALL) {
        if (isStoreVariableInStoreDeclaration(content, d)) {
          // Keep this error - it's a real store usage error
          return true;
        }
      }
      return false;
    }

    // 2. USED_BEFORE_ASSIGNED (TS2454): ignore export let props
    if (d.code === DiagnosticCode.USED_BEFORE_ASSIGNED) {
      if (isExportLetProp(content, d)) {
        return false;
      }
    }

    // 3. UNUSED_LABEL (TS7028): ignore $: reactive statements
    if (d.code === DiagnosticCode.UNUSED_LABEL) {
      return false;
    }

    // 4. DEPRECATED_SIGNATURE (TS6387): ignore $$_ generated variables
    if (d.code === DiagnosticCode.DEPRECATED_SIGNATURE) {
      if (generatedVarRegex.test(d.message)) {
        return false;
      }
    }

    // 5. DUPLICATE_IDENTIFIER / MULTIPLE_PROPS_SAME_NAME: ignore in JSX attributes
    if (
      d.code === DiagnosticCode.DUPLICATE_IDENTIFIER ||
      d.code === DiagnosticCode.MULTIPLE_PROPS_SAME_NAME
    ) {
      // Ignore if occurring in JSX attribute (simple heuristic)
      if (isInJsxAttribute(content, d)) {
        return false;
      }
    }

    // 6. DUPLICATED_JSX_ATTRIBUTES: valid in Svelte
    if (d.code === DiagnosticCode.DUPLICATED_JSX_ATTRIBUTES) {
      return false;
    }

    // 7. PROPERTY_MISSING (TS2741): ignore SvelteComponent type mismatch from bind:this
    // svelte2tsx infers bind:this as SvelteComponent, missing exported function types
    if (d.code === DiagnosticCode.PROPERTY_MISSING) {
      if (isBindThisAssignment(content, d)) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Check if error is from a store variable in $store declaration
 * Ported from svelte-check's isStoreVariableIn$storeDeclaration
 *
 * In svelte2tsx, `$page` is converted to:
 * `let $page = __sveltets_2_store_get(page);`
 *
 * If `page` is not a valid store, TS2769 error occurs at the `page` position
 * inside `__sveltets_2_store_get(page)`.
 */
function isStoreVariableInStoreDeclaration(content: string, d: Diagnostic): boolean {
  const lines = content.split('\n');

  // Calculate character offset up to the error position
  let offset = 0;
  for (let i = 0; i < d.line - 1 && i < lines.length; i++) {
    const line = lines[i];
    if (line !== undefined) {
      offset += line.length + 1; // +1 for newline
    }
  }
  offset += d.column - 1;

  // Check if the position is right after `__sveltets_2_store_get(`
  const expectedStart = offset - STORE_GET_PATTERN.length;
  if (expectedStart < 0) return false;

  const preceding = content.substring(expectedStart, offset);
  return preceding === STORE_GET_PATTERN;
}

/**
 * Check if position is inside ignore region
 */
function isInGeneratedCode(content: string, d: Diagnostic): boolean {
  const lines = content.split('\n');

  // Calculate character offset up to the line
  let offset = 0;
  for (let i = 0; i < d.line - 1 && i < lines.length; i++) {
    const line = lines[i];
    if (line !== undefined) {
      offset += line.length + 1; // +1 for newline
    }
  }
  offset += d.column - 1;

  // Find ignore regions
  let inIgnore = false;
  let searchPos = 0;

  while (true) {
    if (inIgnore) {
      const endPos = content.indexOf(IGNORE_END, searchPos);
      if (endPos === -1 || endPos > offset) {
        return true; // offset is inside ignore region
      }
      searchPos = endPos + IGNORE_END.length;
      inIgnore = false;
    } else {
      const startPos = content.indexOf(IGNORE_START, searchPos);
      if (startPos === -1 || startPos > offset) {
        return false; // offset is outside ignore region
      }
      searchPos = startPos + IGNORE_START.length;
      inIgnore = true;
    }
  }
}

/**
 * Check if variable is declared with export let
 */
function isExportLetProp(content: string, d: Diagnostic): boolean {
  // Extract variable name from error message
  // "Variable 'xxx' is used before being assigned."
  const match = d.message.match(/Variable '(\w+)' is used before being assigned/);
  if (!match) return false;

  const varName = match[1];

  // Check for export let varName pattern
  const exportLetPattern = new RegExp(`export\\s+let\\s+${varName}\\b`);
  return exportLetPattern.test(content);
}

/**
 * Check if position is in JSX attribute (simple heuristic)
 */
function isInJsxAttribute(content: string, d: Diagnostic): boolean {
  const lines = content.split('\n');
  if (d.line <= 0 || d.line > lines.length) return false;

  const line = lines[d.line - 1];
  if (line === undefined) return false;

  // Error inside < ... > tag
  // Simple check: if line contains < and = or {, assume JSX attribute
  return line.includes('<') && (line.includes('=') || line.includes('{'));
}

/**
 * Check if error is from bind:this assignment
 *
 * In svelte2tsx generated code, bind:this is converted to:
 * `variableName = $$_componentVar;`
 *
 * This assignment causes type mismatch between SvelteComponent and user-defined type
 */
function isBindThisAssignment(content: string, d: Diagnostic): boolean {
  const lines = content.split('\n');
  if (d.line <= 0 || d.line > lines.length) return false;

  const line = lines[d.line - 1];
  if (line === undefined) return false;

  // Pattern: `varName = $$_...;` (bind:this assignment)
  // svelte2tsx generates temporary variables starting with $$_
  return /\w+\s*=\s*\$\$_\w+/.test(line);
}

/**
 * Load TSX file contents (supports new path structure)
 */
export function loadTsxContents(files: string[], rootDir: string): Map<string, string> {
  const contents = new Map<string, string>();

  for (const file of files) {
    // Convert relative path to absolute path
    const absolutePath = resolve(rootDir, file);

    if (!existsSync(absolutePath)) {
      continue;
    }

    try {
      const content = readFileSync(absolutePath, 'utf-8');
      contents.set(file, content);
    } catch {
      // Ignore file read failures
    }
  }

  return contents;
}

/**
 * Extract .svelte.tsx file paths
 */
export function extractTsxFiles(diagnostics: Diagnostic[]): string[] {
  const files = new Set<string>();
  for (const d of diagnostics) {
    if (d.file.endsWith('.svelte.tsx')) {
      files.add(d.file);
    }
  }
  return Array.from(files);
}
