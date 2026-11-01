import react from "@vitejs/plugin-react"
import { defineConfig } from "electron-vite"
import packageJson from "./package.json" with { type: "json" }

export default defineConfig({
  main: {},
  preload: {
    build: {
      rollupOptions: {
        external: ["electron"],
        output: {
          entryFileNames: "[name].cjs",
          format: "cjs",
        },
      },
    },
  },
  renderer: {
    // The installed version, shown in Settings.
    define: { __STILLSTREAM_VERSION__: JSON.stringify(packageJson.version) },
    plugins: [react()],
  },
})
