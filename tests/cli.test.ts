import { describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const cliPath = resolve(import.meta.dir, "../dist/cli.js");
const fixturesDir = resolve(import.meta.dir, "fixtures");

/**
 * Run CLI command and return stdout, stderr, and exit code
 */
function runCli(args: string[]): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
}> {
  return new Promise((resolve) => {
    const proc = spawn("node", [cliPath, ...args], {
      cwd: fixturesDir,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      resolve({
        stdout,
        stderr,
        exitCode: code ?? 0,
      });
    });
  });
}

describe("CLI", () => {
  describe("--help flag", () => {
    test("should show help and exit with 0", async () => {
      const result = await runCli(["--help"]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("svelte-fast-check");
      expect(result.stdout).toContain("--config");
      expect(result.stdout).toContain("--incremental");
    });

    test("-h should also work", async () => {
      const result = await runCli(["-h"]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("svelte-fast-check");
    });
  });

  describe("--version flag", () => {
    test("should show version and exit with 0", async () => {
      const result = await runCli(["--version"]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toMatch(/\d+\.\d+\.\d+/);
    });
  });
});
