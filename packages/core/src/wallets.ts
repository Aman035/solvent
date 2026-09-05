import { mnemonicToAccount, type HDAccount } from "viem/accounts";
import { env } from "./env.js";

/** Fixed derivation indices. Never renumber - addresses are referenced in docs and on-chain. */
export const WALLET_INDEX = {
  deployer: 0,
  alice: 1,
  bob: 2,
  mallory: 3,
  attestor: 4,
  poorTaker: 5,
} as const;

export type NamedRole = keyof typeof WALLET_INDEX;
/** Sybil burners occupy indices 6..25 (20 of them) - the Mallory review set. */
export const SYBIL_START = 6;
export const SYBIL_COUNT = 20;

export function account(index: number): HDAccount {
  return mnemonicToAccount(env.MNEMONIC, { addressIndex: index });
}
export function role(r: NamedRole): HDAccount { return account(WALLET_INDEX[r]); }
export function sybil(i: number): HDAccount {
  if (i < 0 || i >= SYBIL_COUNT) throw new Error(`sybil index out of range: ${i}`);
  return account(SYBIL_START + i);
}
export function allSybils(): HDAccount[] {
  return Array.from({ length: SYBIL_COUNT }, (_, i) => sybil(i));
}
/** Every wallet the project uses, in derivation order. */
export function allWallets(): { label: string; index: number; account: HDAccount }[] {
  const named = (Object.keys(WALLET_INDEX) as NamedRole[]).map((r) => ({
    label: r, index: WALLET_INDEX[r], account: role(r),
  }));
  const burners = allSybils().map((a, i) => ({
    label: `sybil[${i}]`, index: SYBIL_START + i, account: a,
  }));
  return [...named, ...burners];
}

/** Minimum balance each role needs before we consider it provisioned. */
export const FUNDING_TARGET_ETH: Record<string, number> = {
  deployer: 0.20, alice: 0.02, bob: 0.02, mallory: 0.01,
  attestor: 0.02, poorTaker: 0.005, sybil: 0.002,
};
export function targetFor(label: string): number {
  return FUNDING_TARGET_ETH[label] ?? FUNDING_TARGET_ETH.sybil;
}
