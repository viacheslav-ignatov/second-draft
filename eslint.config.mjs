// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  { ignores: ["dist/**", "release/**", "node_modules/**", "src/generated/**"] },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // The AI globals genuinely may not exist, so narrow casts around them are
      // deliberate rather than laziness.
      "@typescript-eslint/no-unnecessary-condition": "off",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-console": ["error", { allow: ["warn", "error", "log"] }],
      eqeqeq: ["error", "always", { null: "ignore" }],
    },
  },

  // Build scripts are plain ESM outside the TS program, so type-aware rules
  // cannot run on them. Merge, rather than replace, the disabling ruleset.
  {
    files: ["scripts/**/*.mjs", "eslint.config.mjs"],
    ...tseslint.configs.disableTypeChecked,
    rules: {
      ...tseslint.configs.disableTypeChecked.rules,
      "no-undef": "off",
    },
  },

  // node:test returns a promise from every `test()` and assert's helpers are
  // used unbound by design; neither is a defect in a test file.
  {
    files: ["tests/**/*.ts"],
    rules: {
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/unbound-method": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
    },
  },

  prettier,
);
