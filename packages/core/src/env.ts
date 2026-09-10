import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
config({ path: resolve(ROOT, ".env") });

const schema = z.object({
  BASE_SEPOLIA_RPC: z.string().url().default("https://sepolia.base.org"),
  BASE_SEPOLIA_RPC_FALLBACK: z.string().url().optional(),
  BASE_MAINNET_RPC: z.string().url().optional(),
  GRAPH_DEPLOY_KEY: z.string().min(16).optional(),
  GRAPH_API_KEY: z.string().min(16).optional(),
  SUBGRAPH_URL: z.string().url().optional(),
  SUBGRAPH_URL_BASE: z.string().url().optional(),
  SUBGRAPH_URL_ARBITRUM: z.string().url().optional(),
  SUBGRAPH_URL_OPTIMISM: z.string().url().optional(),
  SUBGRAPH_STUDIO_ID: z.string().optional(),
  SUBGRAPH_SLUG: z.string().optional(),
  BASESCAN_API_KEY: z.string().min(16).optional(),
  MNEMONIC: z.string().min(20).optional(),
  /** CI keeper override: the attestor's own key, so CI never holds the mnemonic. */
  ATTESTOR_PK: z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional(),
  TARGET_CHAIN: z.enum(["base-sepolia", "base"]).default("base-sepolia"),
});

/**
 * Lazy: parsed on first access, so importing the SDK without a .env never throws.
 * Fields that guard real actions (MNEMONIC for signing) are checked at use sites.
 */
type Env = z.infer<typeof schema>;
let parsed: Env | null = null;
export const env: Env = new Proxy({} as Env, {
  get(_t, k) { return (parsed ??= schema.parse(process.env))[k as keyof Env]; },
}) as Env;
export const REPO_ROOT = ROOT;

/** Redact secrets for safe logging. Never log a raw key. */
export function mask(v: string): string {
  if (v.length <= 8) return "****";
  return `${v.slice(0, 4)}…${v.slice(-2)}`;
}
