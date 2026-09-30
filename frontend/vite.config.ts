import path from "path";
import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "vite";

export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "./src"),
        },
    },
    server: {
        proxy: {
            // Proxy requests from port 5173 to 3000
            "/api": {
                target: "http://localhost:3000",
                ws: true,
            },
        },
    },
});
