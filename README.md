# shared-utils

Shared, **business-free** utilities for the columbus ecosystem, organized by publishable unit (not by language) and
published per language to each language's own registry.

## Packages

| Package                             | Registry | Contents                                             |
| ----------------------------------- | -------- | ---------------------------------------------------- |
| `@shared-utils/ui` (`packages/ui/`) | JSR      | React + MUI UI primitives. Currently: `DetentSheet`. |

Every publishable unit lives under `packages/`, regardless of language — each package self-describes its language via
its own manifest (`deno.json`, `Cargo.toml`, `pyproject.toml`, …) and publishes to that language's registry (JSR /
crates.io / PyPI / …). The repo root stays language-agnostic.

## `@shared-utils/ui`

`react`, `@mui/material`, `@emotion/react` are **peer dependencies** — bare specifiers resolved by each consumer's own
import map, so there is a single React instance (no duplicate-React hook breakage). The kit therefore carries no
animation libraries (`DetentSheet` is hand-rolled: pointer events + rAF + CSS transitions, dependency-free).

## Quality gate

`deno task verify` = `deno fmt --check` → `oxlint --deny-warnings` → `eslint` (React Compiler) → `deno check`. All four
must pass; everything is set to the strictest level that doesn't fight React/MUI or the formatter.

### Types — strictest

`deno.json` `compilerOptions` turns on `strict` plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
`noPropertyAccessFromIndexSignature`, `verbatimModuleSyntax`, `noImplicitOverride`, `noImplicitReturns`,
`noFallthroughCasesInSwitch`, `noUnused{Locals,Parameters}`, `allowUnreachableCode:false`. This is the real type-safety
gate.

### Lint — oxlint (`.oxlintrc.json`)

**All five categories on as errors** — `correctness`, `suspicious`, `perf`, `pedantic`, `style` — with the `typescript`
/ `react` / `jsx-a11y` / `promise` / `unicorn` / `oxc` plugins. A few rules are **tuned to sane bounds** (still on):
`eqeqeq` allows `== null`, `func-style` allows declarations, `jsx-max-depth` ≤ 6, `max-lines` ≤ 500,
`max-lines-per-function` ≤ 350, `max-statements` ≤ 50.

A handful are **off, each with cause** — they are pure style with no safety value and demonstrably make _this_ code
worse or fight another tool:

| Rule                            | Why off                                                                                                                                                                               |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `capitalized-comments`          | its auto-fix capitalizes the continuation lines of multi-line comment blocks, corrupting prose                                                                                        |
| `no-inline-comments`            | the trailing annotations (`// full`, `// px/ms`) are deliberate and read better inline                                                                                                |
| `no-magic-numbers`              | geometry/animation literals (`0.5`, `0.12`, `0`) are clearer as numbers than as named constants                                                                                       |
| `id-length`                     | single-letter math locals (`x`, `y`, `dt`, `vy`) are the clearest names here                                                                                                          |
| `no-ternary`                    | ternaries are idiomatic in JSX and value selection; banning them yields worse code                                                                                                    |
| `sort-keys`                     | would alphabetize `sx` props, destroying their logical (layout → visual) grouping                                                                                                     |
| `sort-imports`                  | sorts members by _local_ name while `deno fmt` sorts by _imported_ name — they fight forever; import order is the formatter's job                                                     |
| `react/react-in-jsx-scope`      | the automatic JSX runtime (`react-jsx`) is in use; `React` need not be in scope                                                                                                       |
| `unicorn/no-null`               | React requires `null` (`return null`, `useRef(null)`)                                                                                                                                 |
| `jsx-a11y/prefer-tag-over-role` | `DetentSheet` uses `role="dialog"` on a div on purpose — a native `<dialog>`/MUI Modal mutates the document and would perturb a hosted cross-origin iframe (see the component header) |

### React Compiler — `eslint.config.mjs`

The one thing oxlint can't do. `eslint-plugin-react-hooks` v6 ships the React Compiler's bailout reasons as a full
granular ruleset (`purity`, `immutability`, `refs`, `set-state-in-render`, `preserve-manual-memoization`, …); its
`recommended-latest` config turns the whole set on. This eslint config runs **only** those rules (oxlint owns everything
else), so the two linters never overlap. It is the real _"is this compiler-safe?"_ gate. The compiler itself is a
build-time Babel transform that runs in the **consumer's** bundler (JSR ships TS source), so each consuming app should
enable `babel-plugin-react-compiler` in its Vite/Babel config.

## Dev

```bash
deno task fmt              # format (deno fmt)
deno task lint             # oxlint
deno task lint:compiler    # eslint — React Compiler rules only
deno task check            # strictest type-check
deno task verify           # all four (CI gate)
```
