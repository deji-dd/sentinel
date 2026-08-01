import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs"],
  minify: true,
  clean: true,
  outDir: "dist",
  noExternal: [
    "dotenv",
    "@sentinel/utils",
    "@sentinel/database",
    "@sentinel/torn-api-manager",
    "@sentinel/torn-api",
    "@sentinel/schemas",
    "@prisma/client",
    "@prisma/adapter-pg",
    "pg",
    "undici",
  ],
  external: [".prisma/client/default"],
});
