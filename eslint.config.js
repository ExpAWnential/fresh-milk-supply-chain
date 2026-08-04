/** Applies shared JavaScript and TypeScript checks without duplicating Prettier's formatting rules. */
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";
import { defineConfig } from "eslint/config";

export default defineConfig([
  {
    ignores: [
      "**/dist/",
      "services/backend/public/",
      "fabric/**/organizations/",
      "fabric/**/crypto-config/",
      "fabric/**/channel-artifacts/"
    ]
  },
  {
    // The .mjs tests are plain Node, so they need the base rules and Node's globals.
    files: ["**/*.mjs", "**/*.js"],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.node }
  },
  {
    files: ["**/*.ts"],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: { globals: globals.node }
  },
  {
    // The demo console runs in the browser, and its JSX resolves component names at use sites.
    files: ["apps/demo-console/**/*.{ts,tsx}"],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } }
    },
    rules: { "no-undef": "off" }
  },
  // Keep this last so formatting rules cannot override Prettier.
  prettier
]);
