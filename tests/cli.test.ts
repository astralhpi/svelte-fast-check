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
      expect(result.stdout).toContain("--project");
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

  describe("--project flag", () => {
    test("should work with monorepo tsconfig.json path", async () => {
      const result = await runCli([
        "--project",
        "monorepo-project/tsconfig.json",
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Found 1 .svelte files");
      expect(result.stdout).toContain("No problems found");
    });

    test("-p should also work", async () => {
      const result = await runCli(["-p", "monorepo-project/tsconfig.json"]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("No problems found");
    });

    test("should error if tsconfig.json not found", async () => {
      const result = await runCli(["--project", "nonexistent/tsconfig.json"]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("tsconfig.json not found");
    });
  });

  describe("--config flag validation", () => {
    test("should error when given .json file", async () => {
      const result = await runCli([
        "--config",
        "monorepo-project/tsconfig.json",
      ]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(
        "--config expects a JavaScript/TypeScript config file",
      );
      expect(result.stderr).toContain("Did you mean --project");
    });

    test("-c with .json should also error", async () => {
      const result = await runCli(["-c", "valid-project/tsconfig.json"]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Did you mean --project");
    });
  });

  describe("type checking", () => {
    test("should exit 0 for valid project", async () => {
      const result = await runCli(["--project", "valid-project/tsconfig.json"]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("No problems found");
    });

    test("should exit 1 for project with errors", async () => {
      const result = await runCli(["--project", "error-project/tsconfig.json"]);

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain("error");
    });
  });

  describe("--no-svelte-warnings flag", () => {
    test("should suppress svelte compiler warnings", async () => {
      const resultWithWarnings = await runCli([
        "--project",
        "warning-project/tsconfig.json",
        "--no-svelte-config",
      ]);

      expect(resultWithWarnings.stdout).toContain("state_referenced_locally");

      const resultNoWarnings = await runCli([
        "--project",
        "warning-project/tsconfig.json",
        "--no-svelte-warnings",
      ]);

      expect(resultNoWarnings.stdout).not.toContain("state_referenced_locally");
      expect(resultNoWarnings.exitCode).toBe(0);
    });
  });

  describe("--svelte-config flag", () => {
    test("should load warningFilter from svelte.config.js by default", async () => {
      // warning-project has svelte.config.js that filters state_referenced_locally
      const result = await runCli([
        "--project",
        "warning-project/tsconfig.json",
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).not.toContain("state_referenced_locally");
    });

    test("--no-svelte-config should ignore svelte.config.js", async () => {
      const result = await runCli([
        "--project",
        "warning-project/tsconfig.json",
        "--no-svelte-config",
      ]);

      // Should show the warning since svelte.config.js is ignored
      expect(result.stdout).toContain("state_referenced_locally");
    });

    test("--svelte-config should accept custom path", async () => {
      const result = await runCli([
        "--project",
        "warning-project/tsconfig.json",
        "--svelte-config",
        "warning-project/svelte.config.js",
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).not.toContain("state_referenced_locally");
    });
  });
});
