/**
 * svelte2tsx conversion module
 *
 * Converts .svelte files to .svelte.tsx under .fast-check/tsx/.
 * Sourcemaps are stored in .fast-check/maps/ for incremental builds.
 * Uses Promise.all + async IO for parallel conversion.
 */

import { svelte2tsx } from 'svelte2tsx';
import { statSync, mkdirSync, existsSync, unlinkSync, readFileSync } from 'fs';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { globSync } from 'glob';
import { resolve, dirname, relative } from 'path';
import { createRequire } from 'module';
import type { ConversionResult, FastCheckConfig, SourceMapData } from './types';

// Get svelte2tsx package path (from svelte-fast-check's own dependencies)
const require = createRequire(import.meta.url);
const svelte2tsxPath = dirname(require.resolve('svelte2tsx/package.json'));

/** .fast-check folder path (relative to project root) */
const DEFAULT_CACHE_ROOT = '.fast-check';
const TSX_DIR = 'tsx';
const MAPS_DIR = 'maps';

function getCacheRoot(config: FastCheckConfig): string {
  return config.cacheDir || DEFAULT_CACHE_ROOT;
}

/** Dynamic tsconfig path */
export const getGeneratedTsconfigPath = (config: FastCheckConfig): string =>
  resolve(config.rootDir, getCacheRoot(config), 'tsconfig.json');

/**
 * Convert source path to cache path
 * src/routes/+layout.svelte -> .fast-check/tsx/src/routes/+layout.svelte.tsx
 */
function getTsxPath(config: FastCheckConfig, sourcePath: string): string {
  const relativePath = relative(config.rootDir, sourcePath);
  return resolve(config.rootDir, getCacheRoot(config), TSX_DIR, relativePath + '.tsx');
}

/**
 * Convert source path to sourcemap cache path
 * src/routes/+layout.svelte -> .fast-check/maps/src_routes_+layout.svelte.map.json
 */
function getMapPath(config: FastCheckConfig, sourcePath: string): string {
  const relativePath = relative(config.rootDir, sourcePath);
  const safeName = relativePath.replace(/[/\\]/g, '_');
  return resolve(config.rootDir, getCacheRoot(config), MAPS_DIR, safeName + '.map.json');
}

/**
 * Initialize cache directories
 */
export function ensureCacheDir(config: FastCheckConfig): void {
  const cacheRoot = getCacheRoot(config);
  const tsxDir = resolve(config.rootDir, cacheRoot, TSX_DIR);
  const mapsDir = resolve(config.rootDir, cacheRoot, MAPS_DIR);

  if (!existsSync(tsxDir)) {
    mkdirSync(tsxDir, { recursive: true });
  }
  if (!existsSync(mapsDir)) {
    mkdirSync(mapsDir, { recursive: true });
  }
}

/**
 * Find all .svelte files and convert to .svelte.tsx (parallel with Promise.all)
 */
export async function convertAllSvelteFiles(config: FastCheckConfig): Promise<ConversionResult[]> {
  ensureCacheDir(config);

  const files = globSync('**/*.svelte', { cwd: config.srcDir });
  console.log(`Found ${files.length} .svelte files`);

  // Parallel conversion with async IO via Promise.all
  const results = await Promise.all(
    files.map((file) => {
      const sourcePath = resolve(config.srcDir, file);
      return convertSvelteFileAsync(config, sourcePath);
    })
  );

  const successCount = results.filter((r) => r.success).length;
  const failCount = results.filter((r) => !r.success).length;

  console.log(`Converted ${successCount} files successfully`);
  if (failCount > 0) {
    console.log(`Failed to convert ${failCount} files`);
  }

  return results;
}

/**
 * Convert a single .svelte file to .svelte.tsx (async)
 */
async function convertSvelteFileAsync(
  config: FastCheckConfig,
  sourcePath: string
): Promise<ConversionResult> {
  const outputPath = getTsxPath(config, sourcePath);
  const mapPath = getMapPath(config, sourcePath);

  try {
    const content = await readFile(sourcePath, 'utf-8');
    const hasTs = content.includes('lang="ts"') || content.includes("lang='ts'");

    const result = svelte2tsx(content, {
      filename: sourcePath,
      isTsFile: hasTs,
      mode: 'ts',
    });

    // Create output directory
    const outputDir = dirname(outputPath);
    if (!existsSync(outputDir)) {
      await mkdir(outputDir, { recursive: true });
    }

    // Save .svelte.tsx file and sourcemap in parallel
    await Promise.all([
      writeFile(outputPath, result.code),
      writeFile(mapPath, JSON.stringify(result.map)),
    ]);

    return {
      sourcePath,
      outputPath,
      map: result.map,
      success: true,
    };
  } catch (e: unknown) {
    const error = e instanceof Error ? e.message : String(e);
    console.error(`Error converting ${sourcePath}: ${error}`);
    return {
      sourcePath,
      outputPath,
      map: { mappings: '', sources: [] as never[] },
      success: false,
      error,
    };
  }
}

/**
 * Load sourcemap (async)
 */
async function loadSourcemap(mapPath: string): Promise<SourceMapData | null> {
  if (!existsSync(mapPath)) {
    return null;
  }

  try {
    const content = await readFile(mapPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Convert only changed files (mtime-based, parallel) + delete orphan tsx files
 */
export async function convertChangedFiles(config: FastCheckConfig): Promise<ConversionResult[]> {
  ensureCacheDir(config);

  const files = globSync('**/*.svelte', { cwd: config.srcDir });
  const validTsxPaths = new Set<string>();

  // Classify files that need conversion vs files to skip
  const toConvert: string[] = [];
  const skippedFiles: Array<{
    sourcePath: string;
    outputPath: string;
    mapPath: string;
  }> = [];

  for (const file of files) {
    const sourcePath = resolve(config.srcDir, file);
    const outputPath = getTsxPath(config, sourcePath);
    const mapPath = getMapPath(config, sourcePath);

    validTsxPaths.add(outputPath);

    // Skip if output file exists and is newer than source
    if (existsSync(outputPath) && existsSync(mapPath)) {
      const sourceStat = statSync(sourcePath);
      const outputStat = statSync(outputPath);

      if (outputStat.mtime >= sourceStat.mtime) {
        skippedFiles.push({ sourcePath, outputPath, mapPath });
        continue;
      }
    }

    toConvert.push(sourcePath);
  }

  // Load sourcemaps for skipped files in parallel
  const skippedResults = await Promise.all(
    skippedFiles.map(async ({ sourcePath, outputPath, mapPath }) => {
      const map = await loadSourcemap(mapPath);
      return {
        sourcePath,
        outputPath,
        map: map || { mappings: '', sources: [] as never[] },
        success: !!map,
      };
    })
  );

  // Convert only changed files in parallel with Promise.all
  const convertedResults = await Promise.all(
    toConvert.map((sourcePath) => convertSvelteFileAsync(config, sourcePath))
  );

  const results = [...skippedResults, ...convertedResults];

  // Delete orphan tsx files (when source has been deleted)
  const orphansDeleted = cleanOrphanTsxFiles(config, validTsxPaths);

  const converted = convertedResults.filter((r) => r.success).length;
  const skipped = skippedResults.length;
  let message = `Converted ${converted} files, skipped ${skipped} unchanged`;
  if (orphansDeleted > 0) {
    message += `, deleted ${orphansDeleted} orphans`;
  }
  console.log(message);

  return results;
}

/**
 * Delete orphan tsx files whose source has been deleted
 */
function cleanOrphanTsxFiles(config: FastCheckConfig, validTsxPaths: Set<string>): number {
  const cacheRoot = getCacheRoot(config);
  const tsxDir = resolve(config.rootDir, cacheRoot, TSX_DIR);
  if (!existsSync(tsxDir)) return 0;

  const existingTsxFiles = globSync('**/*.svelte.tsx', { cwd: tsxDir });
  let deleted = 0;

  for (const file of existingTsxFiles) {
    const tsxPath = resolve(tsxDir, file);
    if (!validTsxPaths.has(tsxPath)) {
      // Delete orphan tsx with no source
      try {
        unlinkSync(tsxPath);

        // Also delete corresponding sourcemap
        const relativePath = file.replace(/\.tsx$/, '');
        const safeName = relativePath.replace(/[/\\]/g, '_');
        const mapPath = resolve(config.rootDir, cacheRoot, MAPS_DIR, safeName + '.map.json');
        if (existsSync(mapPath)) {
          unlinkSync(mapPath);
        }

        deleted++;
      } catch {
        // Ignore deletion failures
      }
    }
  }

  return deleted;
}

/**
 * Return all sourcemaps as a Map
 */
export function buildSourcemapMap(results: ConversionResult[]): Map<string, SourceMapData> {
  const maps = new Map<string, SourceMapData>();

  for (const result of results) {
    if (result.success && result.map) {
      maps.set(result.outputPath, result.map);
    }
  }

  return maps;
}

export interface GenerateTsconfigOptions {
  /** Whether to use incremental build (default: true) */
  incremental?: boolean;
}

/**
 * .fast-check/tsconfig.json 생성 (tsgo용)
 *
 * 프로젝트의 tsconfig.json을 읽어서 기반으로 하고,
 * fast-check에 필요한 설정만 덮어씁니다.
 */
export async function generateTsconfig(
  config: FastCheckConfig,
  options: GenerateTsconfigOptions = {}
): Promise<string> {
  const { incremental = false } = options;
  const tsconfigPath = getGeneratedTsconfigPath(config);

  // Read project tsconfig.json (following extends chain to .svelte-kit/tsconfig.json)
  const projectTsconfig = readTypesFromTsconfig(config.rootDir);

  // Read paths from tsconfig.json, use SvelteKit defaults if not present
  const tsconfigPaths = (projectTsconfig?.compilerOptions?.paths as Record<string, string[]>) || {};
  const defaultPaths: Record<string, string[]> = {
    $lib: ['./../src/lib'],
    '$lib/*': ['./../src/lib/*'],
  };
  // Priority: config.paths > tsconfig paths > defaults
  const paths = { ...defaultPaths, ...tsconfigPaths, ...config.paths };

  // Generate tsconfig for fast-check
  // Override only necessary settings on top of project tsconfig's compilerOptions
  const tsconfigContent = {
    compilerOptions: {
      // Settings inherited from project tsconfig
      ...projectTsconfig?.compilerOptions,

      // Settings forced by fast-check (overrides)
      noEmit: true,
      skipLibCheck: true,
      jsx: 'preserve',
      jsxImportSource: 'svelte',

      // Incremental build settings
      incremental,
      tsBuildInfoFile: incremental ? './.tsbuildinfo' : undefined,

      // rootDirs: merge tsx folder with project root
      rootDirs: ['..', '../.svelte-kit/types', './tsx'],

      // paths need to be converted to relative paths
      paths,

      // Use defaults if lib is not specified
      lib: projectTsconfig?.compilerOptions?.lib || ['esnext', 'DOM', 'DOM.Iterable'],

      // Prevent @types/react's global.d.ts from polluting DOM types
      // Explicitly set types to disable @types/* auto-loading
      types: config.types ?? [],
    },

    // svelte2tsx shims + app.d.ts for DOM type overrides
    // Use absolute paths to svelte2tsx from svelte-fast-check's dependencies
    files: [
      '../src/app.d.ts',
      resolve(svelte2tsxPath, 'svelte-shims-v4.d.ts'),
      resolve(svelte2tsxPath, 'svelte-jsx-v4.d.ts'),
    ],

    include: [
      '../.svelte-kit/ambient.d.ts',
      '../.svelte-kit/non-ambient.d.ts',
      '../.svelte-kit/types/**/$types.d.ts',
      '../src/**/*.ts',
      '../src/**/*.d.ts',
      './tsx/**/*.svelte.tsx',
      ...(config.include || []),
    ],

    exclude: [
      '../src/**/*.spec.ts',
      '../src/**/*.test.ts',
      '../node_modules/**',
      // Include excludes from tsconfig.json
      ...(projectTsconfig?.exclude || []).map((p: string) => `../${p}`),
      ...(config.exclude || []),
    ],
  };

  await writeFile(tsconfigPath, JSON.stringify(tsconfigContent, null, 2));
  return tsconfigPath;
}

/**
 * Read project tsconfig.json (recursively resolve extends chain)
 */
function readTypesFromTsconfig(
  rootDir: string,
  tsconfigFileName: string = 'tsconfig.json'
): { compilerOptions?: Record<string, unknown>; exclude?: string[] } | null {
  const tsconfigPath = resolve(rootDir, tsconfigFileName);
  if (!existsSync(tsconfigPath)) return null;

  try {
    const content = readFileSync(tsconfigPath, 'utf-8');
    const tsconfig = JSON.parse(content);
    const tsconfigDir = dirname(tsconfigPath);

    // If extends is present, recursively read and merge parent settings
    if (tsconfig.extends) {
      const extendsPath = resolve(tsconfigDir, tsconfig.extends);
      const parentDir = dirname(extendsPath);
      const parentFileName = extendsPath.split('/').pop() || 'tsconfig.json';

      const parentTsconfig = readTypesFromTsconfig(parentDir, parentFileName);
      if (parentTsconfig) {
        return {
          compilerOptions: {
            ...parentTsconfig.compilerOptions,
            ...tsconfig.compilerOptions,
          },
          exclude: tsconfig.exclude || parentTsconfig.exclude,
        };
      }
    }

    return tsconfig;
  } catch {
    return null;
  }
}
