import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";
import { defineConfig } from "eslint/config";

export default defineConfig([
  {
    ignores: [
      "**/dist/",
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
  // Last, so ESLint never argues with Prettier about formatting.
  prettier
]);
