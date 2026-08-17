import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

// base はリポジトリ名に合わせます。
// リポジトリ名を bosai-app 以外にした場合は、ここを必ず書き換えてください。
// 例：リポジトリ名が bosai-hyoka なら "/bosai-hyoka/"
export default defineConfig({
  plugins: [react()],
  base: "/bosai-app/",
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        admin: resolve(__dirname, "admin.html"),
      },
    },
  },
});
