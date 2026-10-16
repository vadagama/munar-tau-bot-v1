import tseslint from "typescript-eslint";

// Функции (Deno) и SQL не входят в зону ESLint: functions/ проверяет deno lint.
export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/node_modules/**", "functions/**", "supabase/**"],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
);
