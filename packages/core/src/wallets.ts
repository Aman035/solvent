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

/**
 * Additional HONEST takers at 26..30.
 *
 * Deliberately separate from the sybil burners: those exist to fake Mallory's reviews,
 * these are genuine distinct counterparties for Alice. The Herfindahl diversity term
 * means a maker with a single counterparty scores ZERO no matter how much volume it
 * honours - so a realistic maker needs several real takers before it can score at all.
 */
export const TAKER_START = 26;
export const TAKER_COUNT = 5;
export function extraTaker(i: number): HDAccount {
  if (i < 0 || i >= TAKER_COUNT) throw new Error(`taker index out of range: ${i}`);
  return account(TAKER_START + i);
}
export function allExtraTakers(): HDAccount[] {
  return Array.from({ length: TAKER_COUNT }, (_, i) => extraTaker(i));
}

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
  const takers = allExtraTakers().map((a, i) => ({
    label: `taker[${i}]`, index: TAKER_START + i, account: a,
  }));
  return [...named, ...burners, ...takers];
}

/** Minimum balance each role needs before we consider it provisioned. */
export const FUNDING_TARGET_ETH: Record<string, number> = {
  deployer: 0.20, alice: 0.02, bob: 0.02, mallory: 0.01,
  attestor: 0.02, poorTaker: 0.005, sybil: 0.002, taker: 0.01,
};
export function targetFor(label: string): number {
  if (label.startsWith("taker")) return FUNDING_TARGET_ETH.taker;
  if (label.startsWith("sybil")) return FUNDING_TARGET_ETH.sybil;
  return FUNDING_TARGET_ETH[label] ?? FUNDING_TARGET_ETH.sybil;
}
