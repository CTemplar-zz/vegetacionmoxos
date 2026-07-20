import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const repositoryRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: resolve(repositoryRoot, "github-pages"),
  base: "/vegetacionmoxos/",
  publicDir: resolve(repositoryRoot, "public"),
  plugins: [react()],
  build: {
    outDir: resolve(repositoryRoot, "dist-pages"),
    emptyOutDir: true,
  },
});
