import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        console: 'readonly',
        process: 'readonly',
        __dirname: 'readonly',
        module: 'readonly',
        require: 'readonly',
        document: 'readonly',
        window: 'readonly',
        globalThis: 'readonly',
        fetch: 'readonly',
        XMLHttpRequest: 'readonly',
        Response: 'readonly',
        HTMLElement: 'readonly',
        Image: 'readonly',
        beforeAll: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        describe: 'readonly',
        it: 'readonly',
        expect: 'readonly',
        vi: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
      'no-console': 'off',
      curly: ['error', 'all'],
      // Prevent regression on the audit-identity gap (closed by GH-97):
      // do not use the literal 'api-key' as a fallback `userId` in audit
      // logs or audit_log row writes. Record `userId` and `apiKeyId` as
      // separate fields so dual-header (JWT + api-key) requests attribute
      // correctly. See packages/backend/docs/auth.md §audit-identity.
      // The selector uses `:matches()` so it catches both forms of the
      // `userId` property: unquoted (Identifier — `key.name`) and
      // quoted (Literal — `key.value`). Without `:matches()` only the
      // unquoted form is detected and a developer writing
      // `{ 'userId': 'api-key' }` would slip past.
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "Property:matches([key.name='userId'], [key.value='userId']) Literal[value='api-key']",
          message:
            "Don't use the 'api-key' literal as a userId. Record `userId: authUser?.id ?? null` and `apiKeyId: apiKey?.id ?? null` as separate fields. See packages/backend/docs/auth.md §audit-identity.",
        },
      ],
    },
  },
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/*.config.js',
      '**/*.config.ts',
      '**/coverage/**',
      '**/*.min.js',
      'pnpm-lock.yaml',
      '**/*.md',
      'apps/demo/**',
    ],
  },
  {
    files: ['apps/demo/**/*.js'],
    languageOptions: {
      globals: {
        BugSpotter: 'readonly',
        rrwebPlayer: 'readonly',
        localStorage: 'readonly',
        navigator: 'readonly',
        alert: 'readonly',
        setTimeout: 'readonly',
        setInterval: 'readonly',
        event: 'readonly',
        Headers: 'readonly',
        Promise: 'readonly',
        JSON: 'readonly',
        Date: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
  {
    files: ['**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        console: 'readonly',
        process: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-var-requires': 'off',
      '@typescript-eslint/no-require-imports': 'off',
    },
  }
);
