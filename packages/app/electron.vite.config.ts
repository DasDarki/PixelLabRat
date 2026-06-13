import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  main: {
    // Bundle our TS workspace packages into the main process (Electron's Node
    // can't import raw .ts); externalize everything else (electron, builtins).
    plugins: [
      externalizeDepsPlugin({
        exclude: ["@pixellabrat/core", "@pixellabrat/store", "@pixellabrat/agent"],
      }),
    ],
    build: { rollupOptions: { input: { index: resolve(__dirname, "src/main/index.ts") } } },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: { index: resolve(__dirname, "src/preload/index.ts") } } },
  },
  renderer: {
    root: resolve(__dirname, "src/renderer"),
    build: { rollupOptions: { input: { index: resolve(__dirname, "src/renderer/index.html") } } },
    plugins: [vue()],
  },
});
