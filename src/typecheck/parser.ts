/**
 * tsc output parsing module
 *
 * Parses tsc stdout into a Diagnostic array.
 */

import type { Diagnostic } from "../types";

/**
 * Parse tsc output
 *
 * tsc output format examples:
 * src/routes/+page.svelte.tsx(10,5): error TS2304: Cannot find name 'foo'.
 * src/lib/utils.ts(25,10): error TS2322: Type 'string' is not assignable to type 'number'.
 */
export function parseTscOutput(output: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const lines = output.split("\n");

  // tsc error pattern: file(line,col): error TScode: message
  const pattern = /^(.+?)\((\d+),(\d+)\):\s*(error|warning)\s+TS(\d+):\s*(.+)$/;

  for (const line of lines) {
    const match = line.match(pattern);
    if (match) {
      const file = match[1];
      const lineStr = match[2];
      const colStr = match[3];
      const severity = match[4];
      const codeStr = match[5];
      const message = match[6];

      if (file && lineStr && colStr && severity && codeStr && message) {
        diagnostics.push({
          file: file.trim(),
          line: parseInt(lineStr, 10),
          column: parseInt(colStr, 10),
          code: parseInt(codeStr, 10),
          message: message.trim(),
          severity: severity as "error" | "warning",
        });
      }
    }
  }

  return diagnostics;
}

/**
 * Count diagnostics by severity
 */
export function countDiagnostics(diagnostics: Diagnostic[]): {
  errorCount: number;
  warningCount: number;
} {
  let errorCount = 0;
  let warningCount = 0;

  for (const d of diagnostics) {
    if (d.severity === "error") {
      errorCount++;
    } else {
      warningCount++;
    }
  }

  return { errorCount, warningCount };
}
