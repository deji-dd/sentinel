import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs"],
  minify: true,
  clean: true,
  outDir: "dist",
  noExternal: [/^(?!.*prisma)/],
  external: [
    ".prisma/client/default",
    "@prisma/client",
    "@prisma/client-runtime-utils",
  ],
});
