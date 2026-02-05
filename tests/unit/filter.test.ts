/**
 * Unit tests for false positive filtering logic
 */

import { describe, expect, test } from "bun:test";
import { filterFalsePositives } from "../../src/typecheck/filter";
import type { Diagnostic } from "../../src/types";

/** Helper to create a diagnostic */
function makeDiag(
  code: number,
  message: string,
  file: string,
  line: number,
  column: number,
): Diagnostic {
  return {
    file,
    line,
    column,
    code,
    message,
    severity: "error",
  };
}

describe("filterFalsePositives", () => {
  describe("ignore regions", () => {
    test("should filter errors inside ignore regions", () => {
      const content = `
const x = 1;
/*Ωignore_startΩ*/
const y = "error here";
/*Ωignore_endΩ*/
const z = 3;
`;
      const diagnostics: Diagnostic[] = [
        makeDiag(2322, "Type error", "test.svelte.tsx", 4, 10),
      ];

      const result = filterFalsePositives(
        diagnostics,
        new Map([["test.svelte.tsx", content]]),
      );

      expect(result).toHaveLength(0);
    });

    test("should keep errors outside ignore regions", () => {
      const content = `
const x = 1;
/*Ωignore_startΩ*/
const y = 2;
/*Ωignore_endΩ*/
const z = "error here";
`;
      const diagnostics: Diagnostic[] = [
        makeDiag(2322, "Type error", "test.svelte.tsx", 6, 10),
      ];

      const result = filterFalsePositives(
        diagnostics,
        new Map([["test.svelte.tsx", content]]),
      );

      expect(result).toHaveLength(1);
    });

    test("should handle multiple ignore regions", () => {
      const content = `
const a = 1;
/*Ωignore_startΩ*/
const b = 2;
/*Ωignore_endΩ*/
const c = 3;
/*Ωignore_startΩ*/
const d = 4;
/*Ωignore_endΩ*/
const e = 5;
`;
      const diagnostics: Diagnostic[] = [
        makeDiag(2322, "Error in b", "test.svelte.tsx", 4, 10), // inside first ignore
        makeDiag(2322, "Error in c", "test.svelte.tsx", 6, 10), // outside
        makeDiag(2322, "Error in d", "test.svelte.tsx", 8, 10), // inside second ignore
        makeDiag(2322, "Error in e", "test.svelte.tsx", 10, 10), // outside
      ];

      const result = filterFalsePositives(
        diagnostics,
        new Map([["test.svelte.tsx", content]]),
      );

      expect(result).toHaveLength(2);
      expect(result[0].message).toBe("Error in c");
      expect(result[1].message).toBe("Error in e");
    });
  });

  describe("TS2769 store errors", () => {
    test("should preserve store errors inside ignore regions", () => {
      const content = `
/*Ωignore_startΩ*/
let $page = __sveltets_2_store_get(page);
/*Ωignore_endΩ*/
`;
      // Error at 'page' position inside __sveltets_2_store_get(page)
      // Line 3, column after '__sveltets_2_store_get('
      const diagnostics: Diagnostic[] = [
        makeDiag(
          2769,
          "No overload matches this call. 'page' does not have 'subscribe'",
          "test.svelte.tsx",
          3,
          36, // position of 'page' after '__sveltets_2_store_get('
        ),
      ];

      const result = filterFalsePositives(
        diagnostics,
        new Map([["test.svelte.tsx", content]]),
      );

      expect(result).toHaveLength(1);
      expect(result[0].code).toBe(2769);
    });

    test("should filter non-store TS2769 errors in ignore regions", () => {
      const content = `
/*Ωignore_startΩ*/
someFunction(invalidArg);
/*Ωignore_endΩ*/
`;
      const diagnostics: Diagnostic[] = [
        makeDiag(
          2769,
          "No overload matches this call",
          "test.svelte.tsx",
          3,
          14,
        ),
      ];

      const result = filterFalsePositives(
        diagnostics,
        new Map([["test.svelte.tsx", content]]),
      );

      expect(result).toHaveLength(0);
    });
  });

  describe("TS2454 export let props", () => {
    test("should filter USED_BEFORE_ASSIGNED for export let", () => {
      const content = `
export let value: string;
console.log(value);
`;
      const diagnostics: Diagnostic[] = [
        makeDiag(
          2454,
          "Variable 'value' is used before being assigned.",
          "test.svelte.tsx",
          3,
          13,
        ),
      ];

      const result = filterFalsePositives(
        diagnostics,
        new Map([["test.svelte.tsx", content]]),
      );

      expect(result).toHaveLength(0);
    });

    test("should keep USED_BEFORE_ASSIGNED for non-export variables", () => {
      const content = `
let value: string;
console.log(value);
`;
      const diagnostics: Diagnostic[] = [
        makeDiag(
          2454,
          "Variable 'value' is used before being assigned.",
          "test.svelte.tsx",
          3,
          13,
        ),
      ];

      const result = filterFalsePositives(
        diagnostics,
        new Map([["test.svelte.tsx", content]]),
      );

      expect(result).toHaveLength(1);
    });
  });

  describe("TS7028 reactive statements", () => {
    test("should filter UNUSED_LABEL for $: reactive statements", () => {
      const content = `
$: doubled = count * 2;
`;
      const diagnostics: Diagnostic[] = [
        makeDiag(7028, "Unused label.", "test.svelte.tsx", 2, 1),
      ];

      const result = filterFalsePositives(
        diagnostics,
        new Map([["test.svelte.tsx", content]]),
      );

      expect(result).toHaveLength(0);
    });
  });

  describe("TS6387 generated variables", () => {
    test("should filter DEPRECATED_SIGNATURE for $$_ variables", () => {
      const content = `const $$_component = new Component();`;
      const diagnostics: Diagnostic[] = [
        makeDiag(
          6387,
          "'$$_component' is deprecated.",
          "test.svelte.tsx",
          1,
          7,
        ),
      ];

      const result = filterFalsePositives(
        diagnostics,
        new Map([["test.svelte.tsx", content]]),
      );

      expect(result).toHaveLength(0);
    });

    test("should filter DEPRECATED_SIGNATURE for $$_.$on pattern", () => {
      const content = `$$_component.$on('click', handler);`;
      const diagnostics: Diagnostic[] = [
        makeDiag(
          6387,
          "'$$_component.$on' is deprecated.",
          "test.svelte.tsx",
          1,
          1,
        ),
      ];

      const result = filterFalsePositives(
        diagnostics,
        new Map([["test.svelte.tsx", content]]),
      );

      expect(result).toHaveLength(0);
    });

    test("should keep DEPRECATED_SIGNATURE for user variables", () => {
      const content = `const myVar = deprecated();`;
      const diagnostics: Diagnostic[] = [
        makeDiag(6387, "'deprecated' is deprecated.", "test.svelte.tsx", 1, 15),
      ];

      const result = filterFalsePositives(
        diagnostics,
        new Map([["test.svelte.tsx", content]]),
      );

      expect(result).toHaveLength(1);
    });
  });

  describe("TS17001 duplicated JSX attributes", () => {
    test("should filter DUPLICATED_JSX_ATTRIBUTES", () => {
      const content = `<Component prop={a} prop={b} />`;
      const diagnostics: Diagnostic[] = [
        makeDiag(
          17001,
          "JSX elements cannot have multiple attributes with the same name.",
          "test.svelte.tsx",
          1,
          21,
        ),
      ];

      const result = filterFalsePositives(
        diagnostics,
        new Map([["test.svelte.tsx", content]]),
      );

      expect(result).toHaveLength(0);
    });
  });

  describe("TS2741 bind:this", () => {
    test("should filter PROPERTY_MISSING for bind:this assignments", () => {
      const content = `componentRef = $$_component;`;
      const diagnostics: Diagnostic[] = [
        makeDiag(
          2741,
          "Property 'myMethod' is missing in type 'SvelteComponent'",
          "test.svelte.tsx",
          1,
          1,
        ),
      ];

      const result = filterFalsePositives(
        diagnostics,
        new Map([["test.svelte.tsx", content]]),
      );

      expect(result).toHaveLength(0);
    });

    test("should keep PROPERTY_MISSING for regular assignments", () => {
      const content = `myObject = anotherObject;`;
      const diagnostics: Diagnostic[] = [
        makeDiag(
          2741,
          "Property 'prop' is missing in type 'A'",
          "test.svelte.tsx",
          1,
          1,
        ),
      ];

      const result = filterFalsePositives(
        diagnostics,
        new Map([["test.svelte.tsx", content]]),
      );

      expect(result).toHaveLength(1);
    });
  });

  describe("TS2300/TS1117 duplicate identifiers in JSX", () => {
    test("should filter DUPLICATE_IDENTIFIER in JSX attributes", () => {
      const content = `<input value={x} value={y} />`;
      const diagnostics: Diagnostic[] = [
        makeDiag(
          2300,
          "Duplicate identifier 'value'.",
          "test.svelte.tsx",
          1,
          18,
        ),
      ];

      const result = filterFalsePositives(
        diagnostics,
        new Map([["test.svelte.tsx", content]]),
      );

      expect(result).toHaveLength(0);
    });

    test("should keep DUPLICATE_IDENTIFIER outside JSX", () => {
      const content = `
const value = 1;
const value = 2;
`;
      const diagnostics: Diagnostic[] = [
        makeDiag(
          2300,
          "Duplicate identifier 'value'.",
          "test.svelte.tsx",
          3,
          7,
        ),
      ];

      const result = filterFalsePositives(
        diagnostics,
        new Map([["test.svelte.tsx", content]]),
      );

      expect(result).toHaveLength(1);
    });
  });

  describe("TS2322 Snippet type mismatch", () => {
    test("should filter Snippet type errors with unique symbol in .svelte.tsx", () => {
      const content = `const snippet: Snippet<[{ close: () => void }]> = props => {};`;
      const diagnostics: Diagnostic[] = [
        makeDiag(
          2322,
          "Type '(props: { close: () => void; }) => { '{@render ...} must be called with a Snippet': \"import type { Snippet } from 'svelte'\"; } & unique symbol' is not assignable to type 'Snippet<[{ close: () => void; }]>'.",
          "test.svelte.tsx",
          1,
          7,
        ),
      ];

      const result = filterFalsePositives(
        diagnostics,
        new Map([["test.svelte.tsx", content]]),
      );

      expect(result).toHaveLength(0);
    });

    test("should keep Snippet errors without unique symbol pattern", () => {
      const content = `const snippet: Snippet<[string]> = (x: number) => {};`;
      const diagnostics: Diagnostic[] = [
        makeDiag(
          2322,
          "Type '(x: number) => void' is not assignable to type 'Snippet<[string]>'.",
          "test.svelte.tsx",
          1,
          7,
        ),
      ];

      const result = filterFalsePositives(
        diagnostics,
        new Map([["test.svelte.tsx", content]]),
      );

      expect(result).toHaveLength(1);
    });

    test("should keep TS2322 errors in non-.svelte.tsx files", () => {
      const content = `const x: string = 123;`;
      const diagnostics: Diagnostic[] = [
        makeDiag(
          2322,
          "Type 'number' is not assignable to type 'Snippet<[]>' with unique symbol.",
          "test.ts", // not .svelte.tsx
          1,
          7,
        ),
      ];

      const result = filterFalsePositives(
        diagnostics,
        new Map([["test.ts", content]]),
      );

      expect(result).toHaveLength(1);
    });

    test("should keep regular TS2322 type errors", () => {
      const content = `const x: string = 123;`;
      const diagnostics: Diagnostic[] = [
        makeDiag(
          2322,
          "Type 'number' is not assignable to type 'string'.",
          "test.svelte.tsx",
          1,
          7,
        ),
      ];

      const result = filterFalsePositives(
        diagnostics,
        new Map([["test.svelte.tsx", content]]),
      );

      expect(result).toHaveLength(1);
    });
  });

  describe("message-only filters for .ts files", () => {
    test("should filter TS2614 *.svelte errors in .ts files", () => {
      const diagnostics: Diagnostic[] = [
        makeDiag(
          2614,
          "Module '\"*.svelte\"' has no exported member 'Graph'.",
          "src/lib/utils.ts",
          1,
          15,
        ),
      ];

      const result = filterFalsePositives(diagnostics, new Map());

      expect(result).toHaveLength(0);
    });

    test("should filter TS2307 asset imports in .ts files", () => {
      const diagnostics: Diagnostic[] = [
        makeDiag(
          2307,
          "Cannot find module './logo.png' or its corresponding type declarations.",
          "src/lib/utils.ts",
          1,
          20,
        ),
      ];

      const result = filterFalsePositives(diagnostics, new Map());

      expect(result).toHaveLength(0);
    });

    test("should keep real TS2614 errors in .ts files", () => {
      const diagnostics: Diagnostic[] = [
        makeDiag(
          2614,
          "Module '\"some-lib\"' has no exported member 'Foo'.",
          "src/lib/utils.ts",
          1,
          15,
        ),
      ];

      const result = filterFalsePositives(diagnostics, new Map());

      expect(result).toHaveLength(1);
    });
  });

  describe("edge cases", () => {
    test("should keep errors when tsx content not available", () => {
      const diagnostics: Diagnostic[] = [
        makeDiag(2322, "Type error", "unknown.svelte.tsx", 1, 1),
      ];

      const result = filterFalsePositives(diagnostics, new Map());

      expect(result).toHaveLength(1);
    });

    test("should handle empty diagnostics", () => {
      const result = filterFalsePositives([], new Map());

      expect(result).toHaveLength(0);
    });

    test("should handle empty content", () => {
      const diagnostics: Diagnostic[] = [
        makeDiag(2322, "Type error", "test.svelte.tsx", 1, 1),
      ];

      const result = filterFalsePositives(
        diagnostics,
        new Map([["test.svelte.tsx", ""]]),
      );

      expect(result).toHaveLength(1);
    });
  });
});
