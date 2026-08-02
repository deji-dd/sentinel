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
    "@prisma/client-runtime-utils",
    "@resvg/resvg-wasm",
    "@resvg/resvg-wasm/index_bg.wasm",
  ],
  esbuildOptions(options) {
    options.external = [
      ...(options.external || []),
      "@resvg/resvg-wasm",
      "@resvg/resvg-wasm/index_bg.wasm",
    ];
  },
});
