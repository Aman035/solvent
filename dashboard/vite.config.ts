import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig(({ mode }) => {
  // read the repo-root .env so the dashboard uses the same live endpoints as the agents
  const env = loadEnv(mode, resolve(__dirname, ".."), "");
  return {
    plugins: [react()],
    server: { port: 5173 },
    define: {
      __SUBGRAPH_URL__: JSON.stringify(env.SUBGRAPH_URL ?? ""),
      __SUBGRAPH_URL_BASE__: JSON.stringify(env.SUBGRAPH_URL_BASE ?? ""),
      __RPC_URL__: JSON.stringify(env.BASE_SEPOLIA_RPC ?? "https://sepolia.base.org"),
      __EXPLORER__: JSON.stringify("https://sepolia.basescan.org"),
      __STUDIO__: JSON.stringify("https://thegraph.com/studio/subgraph/proof-of-fill"),
    },
  };
});
