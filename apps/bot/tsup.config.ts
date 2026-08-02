import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs"],
  minify: true,
  clean: true,
  outDir: "dist",
  noExternal: [/^(?!.*prisma)/],
  external: [".prisma/client/default", "@prisma/client-runtime-utils"],
  esbuildOptions(options) {
    // sharp (and other ESM packages) call createRequire(import.meta.url).
    // esbuild replaces import.meta with {} in CJS output, leaving .url as
    // undefined. Inject a proper CJS shim so createRequire gets a valid URL.
    options.define = {
      ...options.define,
      "import.meta.url": "__importMetaUrl",
    };
    options.banner = {
      js: "const __importMetaUrl = require('url').pathToFileURL(__filename).href;",
    };
  },
});
