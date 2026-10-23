import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import betterTailwindcss from "eslint-plugin-better-tailwindcss";

// Type checking is tsc --noEmit's job (npm run build, .githooks/pre-commit),
// not ESLint's: deliberately using the non-type-aware `recommended` config
// so this stays fast rather than duplicating that gate.
//
// Two tiers, intentionally: js/typescript-eslint's base "recommended" rules
// (below) have no `files` restriction, so `eslint .` applies them repo-wide
// to every TS/JS file including root-level config files like this one and
// vite.config.ts (basic hygiene: no-unused-vars, etc. is worth catching
// everywhere). The React/Tailwind-specific rules in the block further down
// ARE scoped to `files: ["src/**/*.{ts,tsx}"]`, since react-hooks and
// Tailwind class ordering only make sense in actual component source.
export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**", "src-tauri/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
      "better-tailwindcss": betterTailwindcss,
    },
    settings: {
      "better-tailwindcss": {
        // Tailwind v4's CSS-first config: no tailwind.config.js exists,
        // the theme lives in this CSS file's `@import "tailwindcss"`.
        entryPoint: "src/styles/index.css",
      },
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",

      // Only the class-order rule, not the plugin's full `stylistic`
      // preset (which also bundles line-wrapping, duplicate/whitespace/
      // deprecated-class checks): ROADMAP asked specifically for a
      // Tailwind class-order rule.
      "better-tailwindcss/enforce-consistent-class-order": "warn",

      // Enforces the CLAUDE.md convention: use cn() from src/lib/utils.ts
      // for conditional className composition, don't reimport clsx or
      // roll a local helper.
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "clsx",
              message: "Use cn() from @/lib/utils instead of importing clsx directly.",
            },
            {
              name: "classnames",
              message: "Use cn() from @/lib/utils instead of importing classnames directly.",
            },
          ],
        },
      ],
    },
  },
);
