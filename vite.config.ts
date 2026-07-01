import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import electron from "vite-plugin-electron";
import electronRenderer from "vite-plugin-electron-renderer";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const isElectron = mode === "electron";

  return {
    base: './',
    server: {
      host: "::",
      port: 8080,
    },
    plugins: [
      react(),
      mode === "development" && componentTagger(),
      isElectron &&
        electron([
          {
            entry: "electron/main.ts",
            onstart({ startup }) {
              startup();
            },
            vite: {
              build: {
                outDir: "dist-electron",
                rollupOptions: {
                  external: ["electron", "usb", "better-sqlite3", "express", "ws", "cors"],
                },
              },
            },
          },
          {
            entry: "electron/preload.ts",
            onstart({ reload }) {
              reload();
            },
            vite: {
              build: {
                outDir: "dist-electron",
                lib: {
                  entry: "electron/preload.ts",
                  formats: ["cjs"],
                  fileName: () => "preload.js",
                },
                rollupOptions: {
                  external: ["electron"],
                  output: {
                    format: "cjs",
                  },
                },
              },
            },
          },
        ]),
      isElectron && electronRenderer(),
    ].filter(Boolean),
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  };
});
