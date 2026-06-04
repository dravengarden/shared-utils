// ESLint flat config — SCOPED to the ONE thing oxlint cannot do: the dedicated
// React Compiler diagnostics. eslint-plugin-react-hooks v6 ships the compiler's
// bailout reasons as a full granular ruleset (purity, immutability, refs,
// set-state-in-render, preserve-manual-memoization, …); its `recommended-latest`
// config turns the whole set on. That is the real "is this code compiler-safe?"
// gate — far more than rules-of-hooks alone.
//
// oxlint owns ALL other linting (see .oxlintrc.json). This runs ONLY the
// react-hooks/compiler rules, so the two linters don't fight. Run via
// `deno task lint:compiler`.
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

const rh = reactHooks.default ?? reactHooks;
const [recommended] = rh.configs["recommended-latest"];

export default [
  {
    ...recommended,
    files: ["packages/**/*.{ts,tsx}"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
];
