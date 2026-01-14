/**
 * TypeCheck Worker
 *
 * Pipeline: svelte2tsx -> tsgo -> filter -> map
 */

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { parentPort } from "node:worker_threads";
import type { FastCheckConfig, WorkerOutput } from "../types";
import {
  buildSourcemapMap,
  convertAllSvelteFiles,
  convertChangedFiles,
  generateTsconfig,
} from "./convert";
import {
  extractTsxFiles,
  filterFalsePositives,
  loadTsxContents,
} from "./filter";
import { filterNegativeLines, mapDiagnostics } from "./mapper";
import { parseTscOutput } from "./parser";

const require = createRequire(import.meta.url);

/** TypeCheck worker input */
export interface TypeCheckInput {
  config: FastCheckConfig;
  incremental: boolean;
  raw: boolean;
}

/** TypeCheck worker output */
export type TypeCheckOutput = WorkerOutput;

function getTsgoPath(): string {
  try {
    const nativePreviewPath = require.resolve(
      "@typescript/native-preview/package.json",
    );
    const packageDir = nativePreviewPath.replace("/package.json", "");
    return `${packageDir}/bin/tsgo.js`;
  } catch {
    return "tsgo";
  }
}

async function run(input: TypeCheckInput): Promise<TypeCheckOutput> {
  const { config, incremental, raw } = input;
  const startTime = performance.now();

  try {
    // Step 1: svelte2tsx conversion
    const results = incremental
      ? await convertChangedFiles(config)
      : await convertAllSvelteFiles(config);

    // Step 2: Generate tsconfig & run tsgo
    const tsconfigPath = await generateTsconfig(config, { incremental });
    const tsgoPath = getTsgoPath();

    // Use spawn instead of spawnSync to avoid ENOBUFS error
    // spawnSync has buffer size limits, spawn streams output without limits
    const output = await new Promise<string>((resolve, reject) => {
      const child = spawn("node", [tsgoPath, "--noEmit", "-p", tsconfigPath], {
        cwd: config.rootDir,
      });

      const chunks: Buffer[] = [];

      child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
      child.stderr.on("data", (chunk: Buffer) => chunks.push(chunk));

      child.on("error", (err) => {
        reject(new Error(`tsgo execution failed: ${err.message}`));
      });

      child.on("close", (code) => {
        const output = Buffer.concat(chunks).toString("utf-8");
        if (code !== 0 && output.trim() === "") {
          return reject(
            new Error(`tsgo execution failed with exit code ${code}.`),
          );
        }
        resolve(output);
      });
    });

    // Step 3: Parse results
    let diagnostics = parseTscOutput(output);
    diagnostics = diagnostics.map((d) => ({ ...d, source: "ts" as const }));

    // Raw mode: skip filter/map, return tsgo output as-is
    if (raw) {
      return {
        diagnostics: diagnostics.map((d) => ({
          ...d,
          originalFile: d.file,
          originalLine: d.line,
          originalColumn: d.column,
        })),
        duration: Math.round(performance.now() - startTime),
      };
    }

    // Step 4: Filter false positives
    const tsxFiles = extractTsxFiles(diagnostics);
    const tsxContents = loadTsxContents(tsxFiles, config.rootDir);
    diagnostics = filterFalsePositives(diagnostics, tsxContents);

    // Step 5: Sourcemap mapping
    const sourcemaps = buildSourcemapMap(results);
    const cacheDir = config.cacheDir || ".fast-check";
    let mapped = mapDiagnostics(
      diagnostics,
      sourcemaps,
      config.rootDir,
      tsxContents,
      cacheDir,
    );
    mapped = filterNegativeLines(mapped);

    return {
      diagnostics: mapped,
      duration: Math.round(performance.now() - startTime),
    };
  } catch (e) {
    return {
      diagnostics: [],
      duration: Math.round(performance.now() - startTime),
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

// Worker message handler
parentPort?.on("message", async (input: TypeCheckInput) => {
  const result = await run(input);
  parentPort?.postMessage(result);
});
