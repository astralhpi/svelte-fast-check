/**
 * False positive filtering module
 *
 * This module filters out false positive TypeScript errors that occur due to:
 *
 * 1. svelte2tsx generated code: svelte2tsx converts .svelte files to .tsx,
 *    generating helper code that can produce spurious type errors.
 *    - Uses Ωignore_startΩ and Ωignore_endΩ comment markers
 *    - Ported from svelte-check's DiagnosticsProvider logic
 *
 * 2. tsgo vs tsc differences: We use tsgo (TypeScript Go port) instead of tsc.
 *    tsgo has stricter or different type inference in some cases, causing errors
 *    that tsc (used by svelte-check) does not report.
 *
 *    Known tsgo issues related to our filters:
 *    - https://github.com/microsoft/typescript-go/issues/2060
 *      "Typescript-go does not infer large generics due to maximum length"
 *    - https://github.com/microsoft/typescript-go/issues/1616
 *      "Type Ordering" issues with complex generic inference
 *
 * Filters from svelte-check (common to both tsc and tsgo):
 * - TS2454: USED_BEFORE_ASSIGNED - export let props pattern
 * - TS7028: UNUSED_LABEL - $: reactive statements
 * - TS6387: DEPRECATED_SIGNATURE - $$_ generated variables
 * - TS2300/1117: DUPLICATE_IDENTIFIER - JSX attribute patterns
 * - TS17001: DUPLICATED_JSX_ATTRIBUTES - valid in Svelte
 * - TS2741: PROPERTY_MISSING - bind:this type mismatch
 * - Ignore region filtering
 *
 * Filters for tsgo-specific issues (tsc does not report these):
 * - TS2345: ARG_TYPE_NOT_ASSIGNABLE in __sveltets_2_ensureComponent
 *   - tsgo fails to infer complex generic types (e.g., Storybook's defineMeta)
 *   - tsc correctly infers these types
 *   - Related: https://github.com/microsoft/typescript-go/issues/2060
 *
 * - TS7006/7031: IMPLICIT_ANY in component prop callbacks
 *   - tsgo doesn't infer callback parameter types in generated code
 *   - tsc handles these correctly
 *
 * - TS2307: MODULE_NOT_FOUND for asset imports (.avif, .png, etc.)
 *   - Both report this, but bundlers handle it at runtime
 *
 * - TS2614: NO_EXPORTED_MEMBER for .svelte type exports
 *   - Module resolution differences between tsgo and tsc
 */

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import type { Diagnostic } from '../types';

/**
 * TS error codes to filter
 *
 * Categories:
 * - [svelte-check]: Ported from svelte-check, applies to both tsc and tsgo
 * - [tsgo-specific]: Only needed for tsgo, tsc doesn't report these
 * - [bundler]: Errors that bundlers (Vite/Webpack) handle, not TypeScript
 */
const DiagnosticCode = {
  // [svelte-check] Filter targets
  USED_BEFORE_ASSIGNED: 2454, // export let x pattern
  UNUSED_LABEL: 7028, // $: reactive statement
  DEPRECATED_SIGNATURE: 6387, // $$_ generated variables

  // [svelte-check] Conditional filtering (Element attributes)
  DUPLICATE_IDENTIFIER: 2300,
  MULTIPLE_PROPS_SAME_NAME: 1117,

  // [svelte-check] JSX related (ignore in svelte components)
  DUPLICATED_JSX_ATTRIBUTES: 17001,

  // [svelte-check] bind:this related - svelte2tsx infers component instance as SvelteComponent
  PROPERTY_MISSING: 2741,

  // [svelte-check] Store related - should NOT be filtered even in ignore regions
  NO_OVERLOAD_MATCHES_CALL: 2769, // Invalid store usage (e.g., $page instead of page)

  // [tsgo-specific] Component type errors from svelte2tsx ensureComponent
  // tsgo fails to infer complex generic return types (e.g., Storybook defineMeta)
  // tsc correctly infers these, so svelte-check doesn't need this filter
  // Issue: https://github.com/microsoft/typescript-go/issues/2060
  ARG_TYPE_NOT_ASSIGNABLE: 2345,

  // [tsgo-specific] Implicit any in callback parameters
  // tsgo doesn't infer callback parameter types in svelte2tsx generated code
  // Issue: https://github.com/microsoft/typescript-go/issues/1616
  IMPLICIT_ANY_PARAMETER: 7006,
  IMPLICIT_ANY_BINDING: 7031,

  // [bundler] Module resolution errors that bundlers handle
  MODULE_NOT_FOUND: 2307,

  // [tsgo-specific] Module resolution differences
  // Issue: https://github.com/microsoft/typescript-go/issues/1616
  NO_EXPORTED_MEMBER: 2614,
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

    // 1. [svelte-check] Ignore errors inside ignore regions
    // svelte2tsx wraps generated code in /*Ωignore_startΩ*/ ... /*Ωignore_endΩ*/ markers.
    // Exception: Store-related errors (TS2769) should be kept even in ignore regions.
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

    // 2. [svelte-check] USED_BEFORE_ASSIGNED (TS2454): ignore export let props
    if (d.code === DiagnosticCode.USED_BEFORE_ASSIGNED) {
      if (isExportLetProp(content, d)) {
        return false;
      }
    }

    // 3. [svelte-check] UNUSED_LABEL (TS7028): ignore $: reactive statements
    if (d.code === DiagnosticCode.UNUSED_LABEL) {
      return false;
    }

    // 4. [svelte-check] DEPRECATED_SIGNATURE (TS6387): ignore $$_ generated variables
    if (d.code === DiagnosticCode.DEPRECATED_SIGNATURE) {
      if (generatedVarRegex.test(d.message)) {
        return false;
      }
    }

    // 5. [svelte-check] DUPLICATE_IDENTIFIER / MULTIPLE_PROPS_SAME_NAME: ignore in JSX attributes
    if (
      d.code === DiagnosticCode.DUPLICATE_IDENTIFIER ||
      d.code === DiagnosticCode.MULTIPLE_PROPS_SAME_NAME
    ) {
      // Ignore if occurring in JSX attribute (simple heuristic)
      if (isInJsxAttribute(content, d)) {
        return false;
      }
    }

    // 6. [svelte-check] DUPLICATED_JSX_ATTRIBUTES: valid in Svelte
    if (d.code === DiagnosticCode.DUPLICATED_JSX_ATTRIBUTES) {
      return false;
    }

    // 7. [svelte-check] PROPERTY_MISSING (TS2741): ignore SvelteComponent type mismatch from bind:this
    // svelte2tsx infers bind:this as SvelteComponent, missing exported function types
    if (d.code === DiagnosticCode.PROPERTY_MISSING) {
      if (isBindThisAssignment(content, d)) {
        return false;
      }
    }

    // 8. [tsgo-specific] ARG_TYPE_NOT_ASSIGNABLE (TS2345): filter ensureComponent errors
    // tsgo fails to infer complex generic return types in libraries like Storybook's defineMeta.
    // Example: `const { Story } = defineMeta({...})` - tsgo infers Story as `{}` instead of
    // the correct component type, causing TS2345 in `__sveltets_2_ensureComponent(Story)`.
    // tsc correctly infers these types, so svelte-check doesn't need this filter.
    // Issue: https://github.com/microsoft/typescript-go/issues/2060
    if (d.code === DiagnosticCode.ARG_TYPE_NOT_ASSIGNABLE) {
      if (
        d.message.includes('ConstructorOfATypedSvelteComponent') ||
        isInEnsureComponentCall(content, d)
      ) {
        return false;
      }
    }

    // 9. [tsgo-specific] IMPLICIT_ANY (TS7006/TS7031): filter in component prop callbacks
    // tsgo doesn't infer callback parameter types in svelte2tsx generated code.
    // Example: `new $$_Component({ props: { "onclick": value => {...} } })`
    // tsc infers `value` type from the component's props, tsgo leaves it as implicit any.
    // Issue: https://github.com/microsoft/typescript-go/issues/1616
    if (
      d.code === DiagnosticCode.IMPLICIT_ANY_PARAMETER ||
      d.code === DiagnosticCode.IMPLICIT_ANY_BINDING
    ) {
      if (d.file.endsWith('.svelte.tsx') && isInComponentPropCallback(content, d)) {
        return false;
      }
    }

    // 10. [bundler] MODULE_NOT_FOUND (TS2307): filter asset imports (images, etc.)
    // Both tsc and tsgo report this, but bundlers (Vite/Webpack) handle these at build time.
    // Examples: import logo from './logo.png', import icon from './icon.avif'
    if (d.code === DiagnosticCode.MODULE_NOT_FOUND) {
      if (isAssetImport(d.message)) {
        return false;
      }
    }

    // 11. [tsgo-specific] NO_EXPORTED_MEMBER (TS2614): filter svelte component type exports
    // tsgo has different module resolution behavior for .svelte files.
    // tsc resolves these correctly via svelte2tsx's type definitions.
    // Issue: https://github.com/microsoft/typescript-go/issues/1616
    if (d.code === DiagnosticCode.NO_EXPORTED_MEMBER) {
      if (d.message.includes('*.svelte')) {
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
 * Check if error is in __sveltets_2_ensureComponent call
 *
 * svelte2tsx generates:
 * `const $$_ComponentName = __sveltets_2_ensureComponent(ComponentName);`
 */
function isInEnsureComponentCall(content: string, d: Diagnostic): boolean {
  const lines = content.split('\n');
  if (d.line <= 0 || d.line > lines.length) return false;

  const line = lines[d.line - 1];
  if (line === undefined) return false;

  return line.includes('__sveltets_2_ensureComponent');
}

/**
 * Check if error is in a component prop callback
 *
 * svelte2tsx generates code like:
 * `new $$_Component({ props: { "onclick": value => { ... } } })`
 */
function isInComponentPropCallback(content: string, d: Diagnostic): boolean {
  const lines = content.split('\n');
  if (d.line <= 0 || d.line > lines.length) return false;

  const line = lines[d.line - 1];
  if (line === undefined) return false;

  // Check context: look back up to 10 lines for component instantiation
  const startLine = Math.max(0, d.line - 10);
  const contextLines = lines.slice(startLine, d.line).join('\n');

  // Check if we're inside a component instantiation block
  if (
    contextLines.includes('__sveltets_2_ensureComponent') ||
    contextLines.includes('new $$_')
  ) {
    // Check for arrow function callback pattern on current line
    if (/"\w+":\s*(async\s+)?\(?\s*\w+\s*(,\s*\w+)*\s*\)?\s*=>/.test(line)) {
      return true;
    }
    // Destructuring pattern: ([url, error]) =>
    if (/\(\s*\[/.test(line) && /\]\s*\)\s*=>/.test(line)) {
      return true;
    }
  }

  // Snippet callbacks: {#snippet name(param)}
  if (line.includes('#snippet') || /\(\s*\w+\s*\)\s*=>/.test(line)) {
    return true;
  }

  return false;
}

/**
 * Check if error is about asset import (images, etc.)
 * These are handled by bundlers like Vite/Webpack
 */
function isAssetImport(message: string): boolean {
  const assetExtensions = ['.avif', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico'];
  const match = message.match(/Cannot find module '([^']*)'/);
  if (!match?.[1]) {
    return false;
  }
  const modulePath = match[1];
  return assetExtensions.some((ext) => modulePath.endsWith(ext));
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
