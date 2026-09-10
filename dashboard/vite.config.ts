import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig(({ mode }) => {
  // read the repo-root .env so the dashboard uses the same live endpoints as the agents
  const env = loadEnv(mode, resolve(__dirname, ".."), "");
  return {
    // GitHub Pages serves the app under /solvent/
    base: env.DASH_BASE ?? "/",
    plugins: [react()],
    server: { port: 5173 },
    define: {
      __SUBGRAPH_URL__: JSON.stringify(env.SUBGRAPH_URL ?? ""),
      __SUBGRAPH_URL_BASE__: JSON.stringify(env.SUBGRAPH_URL_BASE ?? ""),
      __SUBGRAPH_URL_ARBITRUM__: JSON.stringify(env.SUBGRAPH_URL_ARBITRUM ?? ""),
      __SUBGRAPH_URL_OPTIMISM__: JSON.stringify(env.SUBGRAPH_URL_OPTIMISM ?? ""),
      // public RPC only: this value is baked into a published bundle, never a keyed URL
      __RPC_URL__: JSON.stringify(env.DASH_RPC ?? "https://sepolia.base.org"),
      __EXPLORER__: JSON.stringify("https://sepolia.basescan.org"),
      // the public GraphiQL playground - viewable by anyone, no login
      __STUDIO__: JSON.stringify((env.SUBGRAPH_URL ?? "") + "/graphql"),
    },
  };
});
