

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import proxyOptions from "./proxyOptions"

export default defineConfig(({ mode }) => {
  const isProd = mode === "production";

  return {
    plugins: [react()],
    server: {
      port: 3000,  // dev server port
      proxy: proxyOptions,
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "src"),
      },
    },
    build: {
      outDir: "../nextlayer/public/frontend",
      emptyOutDir: true,
      target: "es2015",
      rollupOptions: {
        output: {
          entryFileNames: 'assets/index-[hash].js',
          chunkFileNames: 'assets/[name]-[hash].js',
          assetFileNames: 'assets/[name]-[hash].[ext]',
        },
      },
    },
    base: isProd ? "/assets/nextlayer/frontend/" : "/",
  };
});
