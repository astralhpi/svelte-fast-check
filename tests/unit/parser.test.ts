import { describe, expect, test } from "bun:test";
import { parseTscOutput } from "../../src/typecheck/parser";

describe("parseTscOutput", () => {
  test("should attach indented elaboration lines to the preceding diagnostic", () => {
    const output = [
      "a.svelte.tsx(1,7): error TS2322: Type 'A' is not assignable to type 'B'.",
      "  Type 'C' is not assignable to type 'D'.",
      "    Type 'E' is not assignable to type 'F'.\r",
      "b.ts(2,3): error TS2304: Cannot find name 'x'.",
      "",
      "Found 2 errors in 2 files.",
      "",
      "Errors  Files",
      "     1  a.svelte.tsx:1",
    ].join("\n");

    const [a, b] = parseTscOutput(output);

    expect(a?.message).toBe("Type 'A' is not assignable to type 'B'.");
    expect(a?.elaboration).toBe(
      "Type 'C' is not assignable to type 'D'.\nType 'E' is not assignable to type 'F'.",
    );
    expect(b?.elaboration).toBeUndefined();
  });
});
