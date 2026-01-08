# svelte-fast-check

`svelte-check`보다 최대 24배 빠른 타입 및 Svelte 컴파일러 경고 체커입니다.

> svelte-check와 동일한 svelte2tsx, svelte/compiler를 사용합니다. 제작자가 프로덕션에서 직접 사용하고 있습니다.

[English](./README.md)

## 왜 svelte-fast-check가 필요한가요?

`svelte-check`가 개발 환경에서 느린 이유는 아래와 같습니다.

1. **Incremental 체크 미지원** - 매번 전체를 다시 체크합니다.
2. **tsc가 느림** - 싱글 스레드, 병렬 처리 없음

svelte-fast-check는 이 두가지 문제를 해결해서 타입 체크 시간을 비약적으로 향상시킵니다.

| 문제 | 해결 |
|------|------|
| Incremental 없음 | [tsgo](https://github.com/microsoft/typescript-go)는 incremental 체크 지원 |
| tsc 느림 | tsgo는 5-10배 빠름 (Go 기반, 병렬) |

svelte2tsx, svelte/compiler는 svelte-check와 동일한 패키지를 사용합니다.

## 체크 범위

- **TypeScript 에러** — `.ts`, `.svelte` 파일
- **Svelte 컴파일러 경고** — unused CSS, a11y 힌트, `state_referenced_locally` 등

**미포함:** CSS 언어 서비스 진단. [eslint-plugin-svelte](https://github.com/sveltejs/eslint-plugin-svelte)나 [Biome](https://biomejs.dev/) (v2.3.11+)을 쓰세요.

## 벤치마크

282개 Svelte 파일 프로젝트, M4 Pro 기준:

| 명령어                                   | 시간  | 비교          |
| ---------------------------------------- | ----- | ------------- |
| `svelte-check`                           | 14.4s | baseline      |
| `svelte-fast-check`                      | 2.6s  | **5.5배 빠름** |
| `svelte-fast-check --incremental` (cold) | 6.0s  | 2.4배 빠름    |
| `svelte-fast-check --incremental` (warm) | 0.6s  | **24배 빠름** |

## 요구사항

- **macOS 또는 Linux** (Windows 미지원)
- **Node.js 22+** 또는 **Bun**
- Svelte 5+
- TypeScript 5+

## 설치

```bash
npm install -D svelte-fast-check
# or
bun add -D svelte-fast-check
```

## 사용법

```bash
# 기본
npx svelte-fast-check

# Incremental 모드 (권장)
npx svelte-fast-check --incremental

# bun이 더 빠릅니다
bun svelte-fast-check --incremental
```

### CLI 옵션

| 옵션                   | 단축 | 설명                                       |
| ---------------------- | ---- | ------------------------------------------ |
| `--incremental`        | `-i` | 변경된 파일만 변환, tsgo incremental 사용  |
| `--project <path>`     | `-p` | tsconfig.json 경로 지정 (모노레포용)       |
| `--no-svelte-warnings` |      | Svelte 컴파일러 경고 생략 (타입만 체크)    |
| `--raw`                | `-r` | 필터링/매핑 없이 원시 출력                 |
| `--config <path>`      | `-c` | 설정 파일 경로 지정                        |

## 설정

대부분 설정 없이 동작합니다. `tsconfig.json`의 `paths`, `exclude`를 자동으로 읽습니다.

커스텀 설정이 필요하면 `svelte-fast-check.config.ts` 파일을 만들면 됩니다.

```typescript
import type { FastCheckConfig } from 'svelte-fast-check';

export default {
  srcDir: './src',
  exclude: ['../src/**/*.test.ts'],
} satisfies FastCheckConfig;
```

## 동작 원리

```
                    ┌─→ svelte2tsx → tsgo → filter → map ─────→┐
.svelte 파일 ───────┤                                          ├──→ 진단 결과
                    └─→ svelte.compile (warnings) → filter ───→┘
```

두 파이프라인이 병렬로 동작합니다:

1. **타입 체크**: svelte2tsx로 `.svelte` → `.tsx` 변환 후 tsgo로 체크
2. **컴파일러 경고**: `svelte.compile({ generate: false })`로 Svelte 경고 수집

결과를 합쳐서 출력합니다.

## 설계

### 시간 분석

282개 Svelte 파일 프로젝트 기준:

**Cold (~2.6초):**
```
svelte2tsx (~640ms)
    ↓
┌───┴───┐
tsgo    svelte/compiler   ← 병렬
(~2000ms)  (~700ms)
└───┬───┘
    ↓
~2600ms
```

**Incremental warm (~0.6초):**
```
svelte2tsx (변경 없으면 스킵)
    ↓
┌───┴───┐
tsgo    svelte/compiler   ← 둘 다 캐시 사용
(~500ms)   (변경 없으면 스킵)
└───┬───┘
    ↓
~600ms
```

빨라지는 이유:
1. **tsgo** - tsc보다 5-10배 빠름 (Go 기반, 병렬, incremental)
2. **병렬 실행** - 타입 체크와 svelte/compiler 동시 실행
3. **Incremental 캐싱** - svelte2tsx, svelte/compiler 모두 변경된 파일만 처리

**왜 svelte2tsx, svelte/compiler는 그대로 쓰나요?**

파서를 새로 만들면 ~640ms 를 절약할 수 있습니다. 유지보수 부담과 안정성을 고려하면 공식 도구를 쓰는 게 낫습니다:
- svelte-check와 동일한 [svelte2tsx](https://github.com/sveltejs/language-tools/tree/master/packages/svelte2tsx) 사용으로 호환성 보장
- Svelte 새 문법(Runes 등)은 버전만 올리면 바로 지원
- 파서 유지보수 부담 없음

### 지원하지 않는 기능

아래 기능은 `svelte-check`가 이미 잘 지원하고 있어서 별도로 구현하지 않았습니다.

- **Language Server** - IDE 기능 (자동완성, hover, go to definition)
- **Watch 모드** - 파일 변경 감지, 자동 재실행

이런 기능이 필요하면 `svelte-check`나 `svelte-language-server`를 사용하세요.

## 제한사항

- **tsgo는 아직 preview 입니다.**
- **False positive** - 발견한 케이스는 대응해뒀습니다. 추가로 발견하면 [이슈](https://github.com/astralhpi/svelte-fast-check/issues) 남겨주세요.

## svelte-check와 함께 사용하기

개발 중에는 `svelte-fast-check`로 빠르게 피드백 받고, CI에서는 `svelte-check`로 정확하게 검증하는 것을 권장합니다.

```json
{
  "scripts": {
    "check": "svelte-fast-check --incremental",
    "check:ci": "svelte-check"
  }
}
```

## 만든 이유

프로젝트가 커지면서 `svelte-check`가 느려졌습니다. incremental 체크와 typescript-go를 적용해보고 싶었습니다.

`svelte-check`는 Language Server 호환성, 크로스 플랫폼 지원 등 고려할 게 많아서 tsgo 같은 실험적 기능을 바로 도입하기 어렵습니다. 공식 지원까지는 시간이 걸릴 테니, 그동안 사용할 수 있는 도구로 만들었습니다.

참고:
- [incremental 빌드 지원 요청](https://github.com/sveltejs/language-tools/issues/2131) (2023~)
- [typescript-go 지원 요청](https://github.com/sveltejs/language-tools/issues/2733) (Blocked)

## 크레딧

[svelte-language-tools](https://github.com/sveltejs/language-tools)의 [svelte2tsx](https://github.com/sveltejs/language-tools/tree/master/packages/svelte2tsx)와 [Svelte 컴파일러](https://github.com/sveltejs/svelte)를 사용했고, [svelte-check](https://github.com/sveltejs/language-tools/tree/master/packages/svelte-check)를 참고해서 만들었습니다.

## 라이선스

MIT License

Copyright (c) 2025 Song Jaehak (astralhpi)

---

Built at [melting.chat](https://melting.chat)
