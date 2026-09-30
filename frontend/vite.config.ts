import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The static builds (mode "space": Hugging Face, GitHub Pages) use relative URLs so the same
// files work at a site root or under a sub-path such as /lexintel-ai/.
export default defineConfig(({ mode }) => ({
  base: mode === "space" ? "./" : "/",
  plugins: [react(), tailwindcss()],
  server: {
    port: 3005,
    host: true,
    strictPort: true,
    // In Docker on Windows/macOS, file events don't cross the bind mount; poll instead.
    watch: process.env.VITE_WATCH_POLLING === "true" ? { usePolling: true, interval: 400 } : undefined,
  },
  preview: { port: 3005 },
  // The AI worker loads ONNX Runtime with dynamic imports, which needs module workers.
  worker: { format: "es" },
  optimizeDeps: { exclude: ["@huggingface/transformers"] },
  build: {
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom"],
          charts: ["recharts"],
          radix: [
            "@radix-ui/react-dialog",
            "@radix-ui/react-dropdown-menu",
            "@radix-ui/react-tabs",
            "@radix-ui/react-tooltip",
            "@radix-ui/react-popover",
          ],
        },
      },
    },
  },
}));
