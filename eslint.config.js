/* 书签管家 · ESLint flat config（ESLint 9+） */
import globals from 'globals';

export default [
  {
    files: ['js/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        ...globals.browser,
        ...globals.webextensions,
        BM: 'readonly',
        BMAnalyzer: 'readonly'
      }
    },
    rules: {
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }],
      'no-console': 'off',
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-constant-condition': ['error', { checkLoops: false }]
    }
  },
  {
    files: ['tests/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node }
    }
  },
  {
    ignores: ['node_modules/', '.workbuddy/']
  }
];
