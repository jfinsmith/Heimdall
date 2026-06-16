/**
 * Baseline lint config. Intentionally lenient — it enforces the rules that catch
 * real bugs (React hooks correctness, obvious mistakes) and leaves stylistic
 * choices to the team, so `npm run lint` can be a CI gate without a giant
 * pre-existing-warning cleanup. Tighten over time.
 */
module.exports = {
  root: true,
  env: { browser: true, es2022: true, node: true },
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2022, sourceType: 'module', ecmaFeatures: { jsx: true } },
  plugins: ['@typescript-eslint', 'react-hooks'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  rules: {
    // TypeScript handles these; the base rules misfire on TS.
    'no-undef': 'off',
    'no-unused-vars': 'off',
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true }],
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-non-null-assertion': 'off',
    '@typescript-eslint/ban-ts-comment': 'off',
    'no-empty': ['warn', { allowEmptyCatch: true }],
    // The high-value rules: hooks correctness.
    'react-hooks/rules-of-hooks': 'error',
    'react-hooks/exhaustive-deps': 'warn',
  },
  ignorePatterns: ['dist', 'node_modules', 'functions', '*.cjs', 'vite.config.ts'],
};
