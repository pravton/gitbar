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
// DOM and React APIs that turn a string into live HTML. See the
// no-restricted-syntax rule below.
const HTML_SINK_RE =
  "/^(dangerouslySetInnerHTML|innerHTML|outerHTML|insertAdjacentHTML|createContextualFragment|DOMParser|parseHTMLUnsafe|setHTMLUnsafe|srcdoc|srcDoc)$/";
const HTML_SINK_MESSAGE =
  "No raw HTML sinks: render untrusted text as React nodes (see src/lib/commentMarkdown.ts).";

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

      // GitBar renders untrusted GitHub text (comments, titles, labels)
      // only as React text nodes. These are the ways HTML could reach the
      // DOM instead; banning them keeps that true if someone later wants
      // "real" markdown rendering. Lift one only with a sanitizer review.
      //
      // The sink names are matched wherever they appear (identifier, JSX
      // attribute, string or template key), so `el.innerHTML`,
      // `el["innerHTML"]`, `{ dangerouslySetInnerHTML }`, `<iframe srcDoc>`
      // and `new window.DOMParser()` are all caught. A key computed at
      // runtime (`el[name]`) can't be checked statically; review owns that.
      "no-restricted-syntax": [
        "error",
        { selector: `:matches(Identifier, JSXIdentifier)[name=${HTML_SINK_RE}]`, message: HTML_SINK_MESSAGE },
        { selector: `Literal[value=${HTML_SINK_RE}]`, message: HTML_SINK_MESSAGE },
        { selector: `TemplateElement[value.raw=${HTML_SINK_RE}]`, message: HTML_SINK_MESSAGE },
        {
          // document.write / writeln, also via window.document or document["write"].
          selector:
            "MemberExpression:matches([computed=false][property.name=/^(write|writeln)$/], [property.value=/^(write|writeln)$/])" +
            ":matches([object.name='document'], [object.property.name='document'], [object.property.value='document'])",
          message: HTML_SINK_MESSAGE,
        },
      ],

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
