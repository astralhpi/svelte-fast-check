import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { resolve } from 'path';
import { rmSync } from 'fs';
import { runFastCheck } from '../src/index';
import type { FastCheckConfig } from '../src/types';

const fixturesDir = resolve(import.meta.dir, 'fixtures');

describe('svelte-fast-check E2E', () => {
  describe('valid-project', () => {
    const projectDir = resolve(fixturesDir, 'valid-project');
    const cacheDir = resolve(projectDir, '.fast-check');

    afterAll(() => {
      rmSync(cacheDir, { recursive: true, force: true });
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
    const cacheDir = resolve(projectDir, '.fast-check');

    afterAll(() => {
      rmSync(cacheDir, { recursive: true, force: true });
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

      const svelteErrors = result.diagnostics.filter(
        (d) => d.originalFile.endsWith('.svelte')
      );

      expect(svelteErrors.length).toBeGreaterThan(0);
    });

    test('should report errors in .ts files', async () => {
      const config: FastCheckConfig = {
        rootDir: projectDir,
        srcDir: resolve(projectDir, 'src'),
      };

      const result = await runFastCheck(config, { quiet: true });

      const tsErrors = result.diagnostics.filter(
        (d) => d.originalFile.endsWith('.ts')
      );

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
});
