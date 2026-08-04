import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Build straight into the backends' static directory so all six companies serve the same console
// from their own origin, which is what makes "switch company" mean "switch certificate".
export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    outDir: "../../services/backend/public",
    emptyOutDir: true
  },
  server: {
    // The live console asks its own origin for the organisation directory.
    proxy: { "/organisations": "http://localhost:3001" }
  }
});
