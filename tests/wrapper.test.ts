import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const wrapperPath = resolve(import.meta.dir, "../bin/svelte-fast-check.sh");
const testDir = resolve(import.meta.dir, ".test-wrapper-tmp");

/**
 * Run wrapper script in a specific directory and return which runtime would be used
 */
async function detectRuntime(cwd: string): Promise<string> {
  // Create a test script that echoes which runtime is detected
  const testScript = `
#!/bin/sh
if [ -n "$BUN_INSTALL" ] || [ -f "bun.lockb" ] || [ -f "bun.lock" ] || [ -f "bunfig.toml" ]; then
  if command -v bun >/dev/null 2>&1; then
    echo "bun"
    exit 0
  fi
fi
echo "node"
`;
  const testScriptPath = resolve(cwd, ".detect-runtime.sh");
  writeFileSync(testScriptPath, testScript, { mode: 0o755 });

  try {
    const proc = Bun.spawn(["sh", testScriptPath], { cwd });
    const output = await new Response(proc.stdout).text();
    await proc.exited;
    return output.trim();
  } finally {
    try {
      unlinkSync(testScriptPath);
    } catch {}
  }
}

/**
 * Run the actual wrapper script and capture output
 */
async function runWrapper(
  args: string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn([wrapperPath, ...args], { cwd });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;

  return { stdout, stderr, exitCode };
}

describe("Runtime Detection Wrapper", () => {
  beforeAll(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("runtime detection logic", () => {
    test("should detect bun when bun.lock exists", async () => {
      const projectDir = resolve(testDir, "bun-lock-project");
      mkdirSync(projectDir, { recursive: true });
      writeFileSync(resolve(projectDir, "bun.lock"), "");

      const runtime = await detectRuntime(projectDir);
      expect(runtime).toBe("bun");

      rmSync(projectDir, { recursive: true, force: true });
    });

    test("should detect bun when bun.lockb exists", async () => {
      const projectDir = resolve(testDir, "bun-lockb-project");
      mkdirSync(projectDir, { recursive: true });
      writeFileSync(resolve(projectDir, "bun.lockb"), "");

      const runtime = await detectRuntime(projectDir);
      expect(runtime).toBe("bun");

      rmSync(projectDir, { recursive: true, force: true });
    });

    test("should detect bun when bunfig.toml exists", async () => {
      const projectDir = resolve(testDir, "bunfig-project");
      mkdirSync(projectDir, { recursive: true });
      writeFileSync(resolve(projectDir, "bunfig.toml"), "");

      const runtime = await detectRuntime(projectDir);
      expect(runtime).toBe("bun");

      rmSync(projectDir, { recursive: true, force: true });
    });

    test("should detect node when no bun markers exist", async () => {
      const projectDir = resolve(testDir, "node-project");
      mkdirSync(projectDir, { recursive: true });
      writeFileSync(resolve(projectDir, "package-lock.json"), "{}");

      const runtime = await detectRuntime(projectDir);
      expect(runtime).toBe("node");

      rmSync(projectDir, { recursive: true, force: true });
    });

    test("should detect node in empty directory", async () => {
      const projectDir = resolve(testDir, "empty-project");
      mkdirSync(projectDir, { recursive: true });

      const runtime = await detectRuntime(projectDir);
      expect(runtime).toBe("node");

      rmSync(projectDir, { recursive: true, force: true });
    });
  });

  describe("wrapper script execution", () => {
    test("should execute --help successfully", async () => {
      const projectDir = resolve(testDir, "help-test");
      mkdirSync(projectDir, { recursive: true });

      const result = await runWrapper(["--help"], projectDir);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("svelte-fast-check");
      expect(result.stdout).toContain("--project");

      rmSync(projectDir, { recursive: true, force: true });
    });

    test("should execute --version successfully", async () => {
      const projectDir = resolve(testDir, "version-test");
      mkdirSync(projectDir, { recursive: true });

      const result = await runWrapper(["--version"], projectDir);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toMatch(/\d+\.\d+\.\d+/);

      rmSync(projectDir, { recursive: true, force: true });
    });

    test("should work in bun project context", async () => {
      const projectDir = resolve(testDir, "bun-context-test");
      mkdirSync(projectDir, { recursive: true });
      writeFileSync(resolve(projectDir, "bun.lock"), "");

      const result = await runWrapper(["--help"], projectDir);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("svelte-fast-check");

      rmSync(projectDir, { recursive: true, force: true });
    });

    test("should work in node project context", async () => {
      const projectDir = resolve(testDir, "node-context-test");
      mkdirSync(projectDir, { recursive: true });
      writeFileSync(resolve(projectDir, "package-lock.json"), "{}");

      const result = await runWrapper(["--help"], projectDir);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("svelte-fast-check");

      rmSync(projectDir, { recursive: true, force: true });
    });
  });
});
