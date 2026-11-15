import js from "@eslint/js";
import ts from "typescript-eslint";
export default ts.config(
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "worker-configuration.d.ts",
      ".wrangler/**",
    ],
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    files: ["**/*.{ts,tsx,js,mjs}"],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
        Buffer: "readonly",
        URL: "readonly",
        fetch: "readonly",
        Request: "readonly",
        Response: "readonly",
        crypto: "readonly",
        setTimeout: "readonly",
        AbortSignal: "readonly",
        URLSearchParams: "readonly",
        TextEncoder: "readonly",
        HTMLRewriter: "readonly",
        D1Database: "readonly",
        D1PreparedStatement: "readonly",
        ExecutionContext: "readonly",
        Fetcher: "readonly",
        Env: "readonly",
      },
    },
  },
);
