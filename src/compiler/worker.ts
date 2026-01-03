/**
 * Compiler Worker
 *
 * Pipeline: svelte.compile -> collect warnings
 */

import { parentPort } from "node:worker_threads";
import type { FastCheckConfig, WorkerOutput } from "../types";
import {
  collectAllSvelteWarnings,
  collectChangedSvelteWarnings,
} from "./collect";

/** Compiler worker input */
export interface CompilerInput {
  config: FastCheckConfig;
  incremental: boolean;
}

/** Compiler worker output */
export type CompilerOutput = WorkerOutput;

async function run(input: CompilerInput): Promise<CompilerOutput> {
  const { config, incremental } = input;
  const startTime = performance.now();

  try {
    const diagnostics = incremental
      ? await collectChangedSvelteWarnings(config)
      : await collectAllSvelteWarnings(config);

    return {
      diagnostics,
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
parentPort?.on("message", async (input: CompilerInput) => {
  const result = await run(input);
  parentPort?.postMessage(result);
});
