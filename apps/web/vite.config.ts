import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // В разработке API на :4000; браузер видит один origin, поэтому cookie и CSRF-проверка работают как в проде
    proxy: { "/api": { target: "http://localhost:4000", changeOrigin: false } },
  },
});
