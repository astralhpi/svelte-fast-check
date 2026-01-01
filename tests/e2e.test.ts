import { describe, test, expect, afterAll } from 'bun:test';
import { resolve } from 'path';
import { rmSync } from 'fs';
import { runFastCheck } from '../src/index';
import type { FastCheckConfig } from '../src/types';

const fixturesDir = resolve(import.meta.dir, 'fixtures');

/** Helper to clean up cache directory after tests */
function cleanupCache(projectDir: string) {
  rmSync(resolve(projectDir, '.fast-check'), { recursive: true, force: true });
}

describe('svelte-fast-check E2E', () => {
  describe('valid-project', () => {
    const projectDir = resolve(fixturesDir, 'valid-project');

    afterAll(() => {
      cleanupCache(projectDir);
    });

    test('should pass with no errors', async () => {
      const config: FastCheckConfig = {
        rootDir: projectDir,
        srcDir: resolve(projectDir, 'src'),
      };

      const result = await runFastCheck(config, { quiet: true });

      expect(result.errorCount).toBe(0);
      expect(result.warningCount).toBe(0);
    });
  });

  describe('error-project', () => {
    const projectDir = resolve(fixturesDir, 'error-project');

    afterAll(() => {
      cleanupCache(projectDir);
    });

    test('should detect type errors', async () => {
      const config: FastCheckConfig = {
        rootDir: projectDir,
        srcDir: resolve(projectDir, 'src'),
      };

      const result = await runFastCheck(config, { quiet: true });

      expect(result.errorCount).toBeGreaterThan(0);
    });

    test('should report errors in .svelte files', async () => {
      const config: FastCheckConfig = {
        rootDir: projectDir,
        srcDir: resolve(projectDir, 'src'),
      };

      const result = await runFastCheck(config, { quiet: true });

      const svelteErrors = result.diagnostics.filter((d) => d.originalFile.endsWith('.svelte'));

      expect(svelteErrors.length).toBeGreaterThan(0);
    });

    test('should report errors in .ts files', async () => {
      const config: FastCheckConfig = {
        rootDir: projectDir,
        srcDir: resolve(projectDir, 'src'),
      };

      const result = await runFastCheck(config, { quiet: true });

      const tsErrors = result.diagnostics.filter((d) => d.originalFile.endsWith('.ts'));

      expect(tsErrors.length).toBeGreaterThan(0);
    });

    test('should map errors to original line numbers', async () => {
      const config: FastCheckConfig = {
        rootDir: projectDir,
        srcDir: resolve(projectDir, 'src'),
      };

      const result = await runFastCheck(config, { quiet: true });

      // All mapped diagnostics should have positive line numbers
      for (const diag of result.diagnostics) {
        expect(diag.originalLine).toBeGreaterThan(0);
      }
    });
  });

  describe('store-error-project', () => {
    const projectDir = resolve(fixturesDir, 'store-error-project');

    afterAll(() => {
      cleanupCache(projectDir);
    });

    test('should detect invalid store usage ($page when page is not a store)', async () => {
      const config: FastCheckConfig = {
        rootDir: projectDir,
        srcDir: resolve(projectDir, 'src'),
      };

      const result = await runFastCheck(config, { quiet: true });

      // When using $page but page doesn't have subscribe method:
      // - TS2769 occurs at __sveltets_2_store_get(page) in ignore region
      // - TS18046 occurs at $page usage location (mapped to original)
      //
      // TS2769 is kept by filter but can't be sourcemap-mapped (in generated code)
      // TS18046 is the user-facing error at the actual usage location
      const storeErrors = result.diagnostics.filter(
        (d) => d.code === 18046 && d.originalFile.endsWith('.svelte')
      );

      expect(storeErrors.length).toBeGreaterThan(0);
      expect(storeErrors[0].message).toContain('unknown');
    });

    test('should not filter store errors even in ignore regions', async () => {
      const config: FastCheckConfig = {
        rootDir: projectDir,
        srcDir: resolve(projectDir, 'src'),
      };

      const result = await runFastCheck(config, { quiet: true });

      // The error should be preserved, not filtered as false positive
      expect(result.errorCount).toBeGreaterThan(0);
    });

    test('should preserve TS2769 in raw mode', async () => {
      const config: FastCheckConfig = {
        rootDir: projectDir,
        srcDir: resolve(projectDir, 'src'),
      };

      // Raw mode shows unfiltered, unmapped diagnostics
      const result = await runFastCheck(config, { quiet: true, raw: true });

      // TS2769 should be present in raw output (before sourcemap mapping)
      const storeErrors = result.diagnostics.filter((d) => d.code === 2769);

      expect(storeErrors.length).toBeGreaterThan(0);
      expect(storeErrors[0].message).toContain('overload');
    });
  });
});
