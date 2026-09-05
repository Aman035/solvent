import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { REPO_ROOT } from "./env.js";
import { activeChain, type ChainConfig } from "./chains.js";

const Entry = z.object({
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  deployBlock: z.number().int().nonnegative(),
  txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/).optional(),
  verifiedUrl: z.string().url().optional(),
  sourceCommit: z.string().optional(),
  note: z.string().optional(),
});
export type ManifestEntry = z.infer<typeof Entry>;

const Manifest = z.object({
  chainId: z.number().int(),
  chainKey: z.string(),
  updatedAt: z.string(),
  contracts: z.record(z.string(), Entry),
});
export type Manifest = z.infer<typeof Manifest>;

function path(c: ChainConfig = activeChain) {
  return resolve(REPO_ROOT, "deployments", `${c.chainId}.json`);
}

export function readManifest(c: ChainConfig = activeChain): Manifest {
  const p = path(c);
  if (!existsSync(p)) {
    return { chainId: c.chainId, chainKey: c.key, updatedAt: new Date().toISOString(), contracts: {} };
  }
  return Manifest.parse(JSON.parse(readFileSync(p, "utf8")));
}

export function writeEntry(name: string, entry: ManifestEntry, c: ChainConfig = activeChain): Manifest {
  const m = readManifest(c);
  m.contracts[name] = Entry.parse(entry);
  m.updatedAt = new Date().toISOString();
  mkdirSync(resolve(REPO_ROOT, "deployments"), { recursive: true });
  writeFileSync(path(c), JSON.stringify(m, null, 2) + "\n");
  return m;
}

/** Throws if a contract the caller depends on has not been deployed yet. */
export function requireAddress(name: string, c: ChainConfig = activeChain): `0x${string}` {
  const m = readManifest(c);
  const e = m.contracts[name];
  if (!e) throw new Error(`${name} not in deployments/${c.chainId}.json - deploy it first`);
  return e.address as `0x${string}`;
}
