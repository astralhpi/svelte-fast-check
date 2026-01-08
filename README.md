# svelte-fast-check

Up to 24x faster type and Svelte compiler warning checker for Svelte/SvelteKit projects.

[Korean](./README.ko.md)

## Status

Experimental — depends on [TypeScript 7 (tsgo)](https://github.com/microsoft/typescript-go) preview. But actively used by the author in production.

## Why svelte-fast-check?

Two things make `svelte-check` slow for development:

1. **No incremental check** - Re-checks everything on every run
2. **tsc is slow** - Single-threaded, no parallelism

We fix both:

| Problem | Solution |
|---------|----------|
| No incremental | [tsgo](https://github.com/microsoft/typescript-go) supports incremental check |
| tsc is slow | tsgo is 5-10x faster (Go-based, parallel) |

Everything else stays the same - we use the same svelte2tsx and svelte/compiler as svelte-check.

## What Gets Checked

- **TypeScript errors** in `.ts` and `.svelte` files
- **Svelte compiler warnings** — unused CSS, a11y hints, `state_referenced_locally`, etc.

**Not included:** CSS language service diagnostics — use [eslint-plugin-svelte](https://github.com/sveltejs/eslint-plugin-svelte) or [Biome](https://biomejs.dev/) (v2.3.11+)

## Benchmark

Measured on a 282-file Svelte project (M4 Pro):

| Command                                  | Time  | Comparison      |
| ---------------------------------------- | ----- | --------------- |
| `svelte-check`                           | 14.4s | baseline        |
| `svelte-fast-check`                      | 2.6s  | **5.5x faster** |
| `svelte-fast-check --incremental` (cold) | 6.0s  | 2.4x faster     |
| `svelte-fast-check --incremental` (warm) | 0.6s  | **24x faster**  |

## Requirements

- **macOS or Linux** (Windows is not supported)
- **Node.js 22+** or **Bun**
- Svelte 5+
- TypeScript 5+

## Installation

```bash
npm install -D svelte-fast-check
# or
bun add -D svelte-fast-check
```

## Usage

```bash
# Basic
npx svelte-fast-check

# Incremental mode (recommended)
npx svelte-fast-check --incremental

# Even faster with bun
bun svelte-fast-check --incremental
```

### CLI Options

| Option                 | Short | Description                                            |
| ---------------------- | ----- | ------------------------------------------------------ |
| `--incremental`        | `-i`  | Convert only changed files, use tsgo incremental build |
| `--project <path>`     | `-p`  | Specify tsconfig.json path (for monorepos)             |
| `--no-svelte-warnings` |       | Skip Svelte compiler warnings (type check only)        |
| `--raw`                | `-r`  | Show raw output without filtering/mapping              |
| `--config <path>`      | `-c`  | Specify config file path                               |

## Configuration

Works out of the box for most projects. Automatically reads `paths` and `exclude` from `tsconfig.json`.

For custom configuration, create `svelte-fast-check.config.ts`:

```typescript
import type { FastCheckConfig } from 'svelte-fast-check';

export default {
  srcDir: './src',
  exclude: ['../src/**/*.test.ts'],
} satisfies FastCheckConfig;
```

## How It Works

```
                    ┌─→ svelte2tsx → tsgo → filter → map ─────→┐
.svelte files ──────┤                                          ├──→ merged diagnostics
                    └─→ svelte.compile (warnings) → filter ───→┘
```

Two pipelines run in parallel:

1. **Type checking**: svelte2tsx converts `.svelte` to `.tsx`, then tsgo type-checks
2. **Compiler warnings**: `svelte.compile({ generate: false })` collects Svelte-specific warnings

Both results are merged and displayed together.

## Design

### Where the Time Goes

On a 282-file Svelte project:

**Cold (~2.6s):**
```
svelte2tsx (~640ms)
    ↓
┌───┴───┐
tsgo    svelte/compiler   ← runs in parallel
(~2000ms)  (~700ms)
└───┬───┘
    ↓
~2600ms
```

**Incremental warm (~0.6s):**
```
svelte2tsx (skip unchanged)
    ↓
┌───┴───┐
tsgo    svelte/compiler   ← both use cache
(~500ms)   (skip unchanged)
└───┬───┘
    ↓
~600ms
```

The speedup comes from:
1. **tsgo** - 5-10x faster than tsc (Go-based, parallel, incremental)
2. **Parallel execution** - Type checking and svelte/compiler run simultaneously
3. **Incremental caching** - svelte2tsx and svelte/compiler skip unchanged files

**Why keep svelte2tsx and svelte/compiler?**

Rewriting the parser would only save ~640ms. Considering maintenance burden and stability, using the official tooling is better:
- Same [svelte2tsx](https://github.com/sveltejs/language-tools/tree/master/packages/svelte2tsx) as svelte-check - guaranteed compatibility
- New Svelte syntax (like Runes) works immediately by updating peer dependencies
- Zero maintenance burden for parser updates

### What We Don't Do

`svelte-check` already handles these well. No need to reinvent:

- **Language Server** - IDE features (autocompletion, hover, go to definition)
- **Watch mode** - file change detection and auto-rerun

For these features, use `svelte-check` or `svelte-language-server`.

## Limitations

- **tsgo is still in preview.**
- **False positives** - Known cases are handled. If you find more, please [open an issue](https://github.com/astralhpi/svelte-fast-check/issues).

## Using with svelte-check

We recommend using `svelte-fast-check` for fast feedback during development, and `svelte-check` for accurate validation in CI:

```json
{
  "scripts": {
    "check": "svelte-fast-check --incremental",
    "check:ci": "svelte-check"
  }
}
```

## Motivation

As my project grew, `svelte-check` became slow. I wanted to try incremental builds and typescript-go.

`svelte-check` has a lot to consider - Language Server compatibility, cross-platform support, and more - so adopting experimental features like tsgo isn't easy. Official support will take time, so I built this to use in the meantime.

See also:

- [Incremental build support request](https://github.com/sveltejs/language-tools/issues/2131) (2023~)
- [typescript-go support request](https://github.com/sveltejs/language-tools/issues/2733) (Blocked)

## Credits

Built with [svelte2tsx](https://github.com/sveltejs/language-tools/tree/master/packages/svelte2tsx) from [svelte-language-tools](https://github.com/sveltejs/language-tools) and [Svelte compiler](https://github.com/sveltejs/svelte). Inspired by [svelte-check](https://github.com/sveltejs/language-tools/tree/master/packages/svelte-check).

## License

MIT License

Copyright (c) 2025 Song Jaehak (astralhpi)

---

Built at [melting.chat](https://melting.chat)
