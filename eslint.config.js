import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/', 'public/', 'logs/', 'workspace/', 'node_modules/', 'context/'],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
);
