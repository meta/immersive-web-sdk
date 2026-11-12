import eslintConfigPrettier from 'eslint-config-prettier';

export default [
  // Place Prettier compatibility first so later rules (like curly) win
  eslintConfigPrettier,
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: (await import('@typescript-eslint/parser')).default,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': (await import('@typescript-eslint/eslint-plugin'))
        .default,
      import: (await import('eslint-plugin-import')).default,
    },
    rules: {
      // Require braces for all control statements (no single-line bodies)
      curly: ['error', 'all'],
      // TypeScript rules
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          args: 'all',
          argsIgnorePattern: '^_',
          caughtErrors: 'all',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-inferrable-types': 'off',

      // Import sorting with better auto-fix support
      'sort-imports': 'off', // Turn off ESLint's sort-imports in favor of import/order
      'import/order': [
        'error',
        {
          groups: [
            'builtin', // Node.js built-in modules
            'external', // External libraries
            'internal', // Internal modules
            'parent', // Parent directories
            'sibling', // Same or sibling directories
            'index', // Index files
          ],
          'newlines-between': 'never',
          alphabetize: {
            order: 'asc',
            caseInsensitive: true,
          },
        },
      ],

      // Allow console.log in this project since it's a build tool
      'no-console': 'off',
      'no-undef': 'off', // TypeScript handles this
      'no-unused-vars': 'off', // Use TypeScript version
    },
  },

  // Test files configuration
  {
    files: ['**/*.test.ts', '**/*.spec.ts', 'test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },

  // Playwright serializes these probes into the browser page. Value imports
  // would create closure dependencies that do not exist in that page world.
  {
    files: ['packages/vite-plugin-dev/src/managed-browser/page-probes.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "ImportDeclaration:not([importKind='type'])",
          message: 'Page probes may only use type imports.',
        },
      ],
    },
  },

  // Global ignores
  {
    ignores: [
      'node_modules/**',
      '**/node_modules/**',
      'dist/**',
      '**/dist/**',
      'lib/**',
      '**/lib/**',
      'examples/**/dist/**',
      'packages/**/dist/**',
      'packages/**/node_modules/**',
      'examples/**/node_modules/**',
      'coverage/**',
      '*.js', // Ignore JS files in root (like this config file)
      '*.mjs',
      '*.d.ts',
      '**/*.d.ts',
      '**/version.ts', // Generated version files
      '**/generated-profiles.ts', // Generated gamepad profiles
      'packages/reference-assets/tools/.temp/**', // Producer scratch workspace
    ],
  },

  // (Prettier compatibility is applied at the top of this config)
];
