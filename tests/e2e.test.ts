import { describe, test, expect, afterAll, beforeAll } from 'bun:test';
import { resolve } from 'path';
import { rmSync, writeFileSync, readFileSync } from 'fs';
import { runFastCheck } from '../src/index';
import type { FastCheckConfig, CheckResult } from '../src/types';

const fixturesDir = resolve(import.meta.dir, 'fixtures');

/** Helper to clean up cache directory after tests */
function cleanupCache(projectDir: string) {
  rmSync(resolve(projectDir, '.fast-check'), { recursive: true, force: true });
}

describe('svelte-fast-check E2E', () => {
  // Run project tests in parallel by caching results in beforeAll
  describe('valid-project', () => {
    const projectDir = resolve(fixturesDir, 'valid-project');
    let result: CheckResult;

    beforeAll(async () => {
      const config: FastCheckConfig = {
        rootDir: projectDir,
        srcDir: resolve(projectDir, 'src'),
      };
      result = await runFastCheck(config, { quiet: true });
    });

    afterAll(() => {
      cleanupCache(projectDir);
    });

    test('should pass with no errors', () => {
      expect(result.errorCount).toBe(0);
      expect(result.warningCount).toBe(0);
    });
  });

  describe('error-project', () => {
    const projectDir = resolve(fixturesDir, 'error-project');
    let result: CheckResult;

    beforeAll(async () => {
      const config: FastCheckConfig = {
        rootDir: projectDir,
        srcDir: resolve(projectDir, 'src'),
      };
      result = await runFastCheck(config, { quiet: true });
    });

    afterAll(() => {
      cleanupCache(projectDir);
    });

    test('should detect type errors', () => {
      expect(result.errorCount).toBeGreaterThan(0);
    });

    test('should report errors in .svelte files', () => {
      const svelteErrors = result.diagnostics.filter((d) => d.originalFile.endsWith('.svelte'));
      expect(svelteErrors.length).toBeGreaterThan(0);
    });

    test('should report errors in .ts files', () => {
      const tsErrors = result.diagnostics.filter((d) => d.originalFile.endsWith('.ts'));
      expect(tsErrors.length).toBeGreaterThan(0);
    });

    test('should map errors to original line numbers', () => {
      for (const diag of result.diagnostics) {
        expect(diag.originalLine).toBeGreaterThan(0);
      }
    });
  });

  describe('store-error-project', () => {
    const projectDir = resolve(fixturesDir, 'store-error-project');
    let result: CheckResult;
    let rawResult: CheckResult;

    beforeAll(async () => {
      const config: FastCheckConfig = {
        rootDir: projectDir,
        srcDir: resolve(projectDir, 'src'),
      };
      // Run both normal and raw mode in parallel
      [result, rawResult] = await Promise.all([
        runFastCheck(config, { quiet: true }),
        runFastCheck(config, { quiet: true, raw: true }),
      ]);
    });

    afterAll(() => {
      cleanupCache(projectDir);
    });

    test('should detect invalid store usage ($page when page is not a store)', () => {
      // When using $page but page doesn't have subscribe method:
      // - TS2769 occurs at __sveltets_2_store_get(page) in ignore region
      // - We find $page usage location and map the error there
      const storeErrors = result.diagnostics.filter(
        (d) => d.code === 2769 && d.originalFile.endsWith('.svelte')
      );

      expect(storeErrors.length).toBeGreaterThan(0);

      // Should point to line 10 where $page is actually used (not comments)
      // Line 10: const currentPath = $page.url.pathname;
      expect(storeErrors[0].originalLine).toBe(10);
      expect(storeErrors[0].originalColumn).toBe(23);

      // Message should match svelte-check format
      expect(storeErrors[0].message).toContain("Cannot use 'page' as a store");
      expect(storeErrors[0].message).toContain('subscribe');
    });

    test('should not filter store errors even in ignore regions', () => {
      // The error should be preserved, not filtered as false positive
      expect(result.errorCount).toBeGreaterThan(0);
    });

    test('should preserve TS2769 in raw mode', () => {
      // TS2769 should be present in raw output (before sourcemap mapping)
      const storeErrors = rawResult.diagnostics.filter((d) => d.code === 2769);

      expect(storeErrors.length).toBeGreaterThan(0);
      expect(storeErrors[0].message).toContain('overload');
    });
  });

  describe('monorepo-project', () => {
    const projectDir = resolve(fixturesDir, 'monorepo-project');
    let result: CheckResult;

    beforeAll(async () => {
      const config: FastCheckConfig = {
        rootDir: projectDir,
        srcDir: resolve(projectDir, 'src'),
      };
      result = await runFastCheck(config, { quiet: true, svelteWarnings: false });
    });

    afterAll(() => {
      cleanupCache(projectDir);
    });

    test('should find svelte files in web/ subdirectory based on tsconfig include', () => {
      // Should find and process svelte files in web/**/*.svelte
      // No errors expected in the valid monorepo project
      expect(result.errorCount).toBe(0);
    });

    test('should work with tsconfig include patterns like web/**/*.svelte', () => {
      // The monorepo fixture has tsconfig with include: ["web/**/*.svelte"]
      // Previously this would return "Found 0 .svelte files"
      // If we found the files, we should have processed them without errors
      expect(result.diagnostics).toBeDefined();
    });
  });

  describe('warning-project (svelte compiler warnings)', () => {
    const projectDir = resolve(fixturesDir, 'warning-project');
    let result: CheckResult;
    let resultNoWarnings: CheckResult;

    beforeAll(async () => {
      const config: FastCheckConfig = {
        rootDir: projectDir,
        srcDir: resolve(projectDir, 'src'),
      };
      // Run both modes in parallel
      [result, resultNoWarnings] = await Promise.all([
        runFastCheck(config, { quiet: true }),
        runFastCheck(config, { quiet: true, svelteWarnings: false }),
      ]);
    });

    afterAll(() => {
      cleanupCache(projectDir);
    });

    test('should detect state_referenced_locally warning', () => {
      // Should have svelte compiler warning
      const svelteWarnings = result.diagnostics.filter(
        (d) => d.code === 0 && d.message.includes('state_referenced_locally')
      );

      expect(svelteWarnings.length).toBeGreaterThan(0);
      expect(svelteWarnings[0].originalFile).toContain('App.svelte');
      expect(svelteWarnings[0].originalLine).toBe(7);
      // Column should be 1-based (17 points to 'c' in 'count')
      expect(svelteWarnings[0].originalColumn).toBe(17);
      expect(svelteWarnings[0].severity).toBe('warning');
    });

    test('should include svelte warning code in message', () => {
      const svelteWarnings = result.diagnostics.filter(
        (d) => d.message.includes('state_referenced_locally')
      );

      expect(svelteWarnings.length).toBeGreaterThan(0);
      // Message should contain the warning code and docs link
      expect(svelteWarnings[0].message).toContain('https://svelte.dev/e/state_referenced_locally');
    });

    test('should skip svelte warnings with --no-svelte-warnings', () => {
      // Should have no svelte compiler warnings
      const svelteWarnings = resultNoWarnings.diagnostics.filter(
        (d) => d.message.includes('state_referenced_locally')
      );

      expect(svelteWarnings.length).toBe(0);
    });

    test('incremental mode should use cache and invalidate on file change', async () => {
      const config: FastCheckConfig = {
        rootDir: projectDir,
        srcDir: resolve(projectDir, 'src'),
      };

      const appPath = resolve(projectDir, 'src/App.svelte');
      const originalContent = readFileSync(appPath, 'utf-8');

      try {
        // First run - should compile and cache
        const result1 = await runFastCheck(config, { quiet: true, incremental: true });
        const warnings1 = result1.diagnostics.filter((d) => d.source === 'svelte');
        expect(warnings1.length).toBe(1);
        expect(warnings1[0].message).toContain('state_referenced_locally');

        // Second run - should use cache (same result)
        const result2 = await runFastCheck(config, { quiet: true, incremental: true });
        const warnings2 = result2.diagnostics.filter((d) => d.source === 'svelte');
        expect(warnings2.length).toBe(1);

        // Modify file to fix the warning
        const fixedContent = `<script lang="ts">
  let count = $state(0);
  
  // GOOD: Use $derived for reactive values
  let doubled = $derived(count * 2);
  
  function increment() {
    count += 1;
  }
</script>

<button onclick={increment}>
  Count: {count}, Doubled: {doubled}
</button>
`;
        writeFileSync(appPath, fixedContent);

        // Third run - cache should be invalidated, no warnings
        const result3 = await runFastCheck(config, { quiet: true, incremental: true });
        const warnings3 = result3.diagnostics.filter((d) => d.source === 'svelte');
        expect(warnings3.length).toBe(0);
      } finally {
        // Restore original content
        writeFileSync(appPath, originalContent);
      }
    });
  });
});
