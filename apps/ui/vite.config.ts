import { defineConfig, searchForWorkspaceRoot } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss(), tsconfigPaths()],
  resolve: {
    alias: {
      react: join(__dirname, "node_modules/react"),
      "react-dom": join(__dirname, "node_modules/react-dom"),
    },
  },
  server: {
    port: 3000,
    fs: {
      allow: [
        // Allow serving files from the monorepo root (needed for pnpm hoisted fonts like Geist)
        searchForWorkspaceRoot(join(__dirname, "../..")),
      ],
    },
  },
});
