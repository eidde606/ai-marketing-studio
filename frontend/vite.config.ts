import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

const developmentSupabaseUrl = "https://jcktibvwgyijdckvcdno.supabase.co";

export default defineConfig(({ mode }) => {
  if (mode === "development") {
    const env = loadEnv(mode, process.cwd(), "");
    if (env.VITE_SUPABASE_URL !== developmentSupabaseUrl) {
      throw new Error(
        "Refusing to start: VITE_SUPABASE_URL must target the isolated development project.",
      );
    }
    if (!env.VITE_SUPABASE_PUBLISHABLE_KEY?.startsWith("sb_publishable_")) {
      throw new Error(
        "Refusing to start: provide the development project publishable key.",
      );
    }
    if (env.VITE_API_BASE_URL !== "http://127.0.0.1:8001") {
      throw new Error(
        "Refusing to start: VITE_API_BASE_URL must target local FastAPI on port 8001.",
      );
    }
  }

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
    css: {
      postcss: {
        plugins: [],
      },
    },
  };
});
