const tsPlugin = require("@typescript-eslint/eslint-plugin");
const tsParser = require("@typescript-eslint/parser");
const importPlugin = require("eslint-plugin-import");
const unicornPlugin = require("eslint-plugin-unicorn");
const securityPlugin = require("eslint-plugin-security");
const prettierPlugin = require("eslint-plugin-prettier");
const vitestPlugin = require("eslint-plugin-vitest");

module.exports = [
  // Ignorar el lint en los siguientes directorios / archivos
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "coverage/**",
      "*.cjs",
      "*.mjs",
      "*.js",
    ],
  },

  // Configuracion principal
  {
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: "./tsconfig.eslint.json",
        tsconfigRootDir: __dirname,
        sourceType: "module",
        ecmaVersion: "latest",
      },
    },

    settings: {
      // Hace que eslint-plugin-import entienda paths/aliases de TS
      "import/resolver": {
        typescript: {
          project: "./tsconfig.json",
        },
      },
    },

    plugins: {
      "@typescript-eslint": tsPlugin,
      import: importPlugin,
      unicorn: unicornPlugin,
      security: securityPlugin,
      prettier: prettierPlugin,
    },

    rules: {
      // reglas recomendadas de typescript
      ...tsPlugin.configs.recommended.rules,
      ...tsPlugin.configs["recommended-type-checked"].rules,

      // reglas básicas
      "no-console": "warn",
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],

      // para consistencia y orden de imports
      "@typescript-eslint/consistent-type-imports": [
        "warn",
        { prefer: "type-imports" },
      ],
      "no-duplicate-imports": "warn",
      "import/newline-after-import": "warn",

      // orden de imports
      "import/order": [
        "warn",
        {
          groups: [
            ["builtin", "external"],
            ["internal"],
            ["parent", "sibling", "index"],
          ],
          "newlines-between": "always",
          alphabetize: { order: "asc", caseInsensitive: true },
        },
      ],

      // prettier
      "prettier/prettier": ["warn"],
    },
  },

  // Configuraciones para los tests
  {
    files: ["**/__tests__/**/*.[jt]s?(x)", "**/?(*.)+(spec|test).[jt]s?(x)"],
    plugins: { vitest: vitestPlugin },
    languageOptions: {
      globals: {
        ...vitestPlugin.environments.env.globals,
      },
    },
    rules: {
      ...vitestPlugin.configs.recommended.rules,

      // Esta regla tira warning si se accede a any, la deshabilite en tests para
      // no andar tipando tanta mrd para un simple test
      "@typescript-eslint/no-unsafe-member-access": "off", // solo en tests

      "vitest/no-disabled-tests": "warn",
      "vitest/no-focused-tests": "error",
      "vitest/valid-expect": "error",
    },
  },
];
