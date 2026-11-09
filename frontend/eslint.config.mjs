import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const USE_SIGNALS =
  "Use @preact/signals-react (useSignal / useComputed / signal) instead of useState; see CONTRIBUTING.md (Frontend).";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    "**/*.spec.ts",
    ".next/**",
    ".open-next/**",
    "out/**",
    "build/**",
    "dist/**",
    "next-env.d.ts",
  ]),
  {
    settings: {
      react: {
        version: "19.0.0",
      },
    },
    rules: {
      "react-hooks/immutability": "off",
    },
  },
  // Component state lives in @preact/signals-react (useSignal, useComputed,
  // signal()), not React's useState: chosen for speed, and kept on purpose.
  {
    files: ["**/*.{js,jsx,ts,tsx,mjs,cjs}"],
    rules: {
      // A selector rather than no-restricted-imports, which would also flag
      // every `import * as React from "react"`.
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "ImportDeclaration[source.value='react'] > ImportSpecifier[imported.name='useState']",
          message: USE_SIGNALS,
        },
        { selector: "CallExpression[callee.name='useState']", message: USE_SIGNALS },
        {
          selector: "MemberExpression[property.name='useState']",
          message: USE_SIGNALS,
        },
      ],
    },
  },
]);

export default eslintConfig;
