import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  base: "/Dashboard/",
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        vcs: resolve(__dirname, "vcs.html")
      }
    }
  }
});
