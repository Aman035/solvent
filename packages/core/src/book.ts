/**
 * TypeScript mirror of SolventBook.computeUtilisationBps.
 *
 * Must stay bit-identical to the Solidity implementation: the dashboard, attestor and
 * agents display or act on this number while the SolvencyFloor and SolvencySkew
 * instructions enforce the on-chain one. Pinned by contracts/test/BookDifferential.t.sol.
 */
export const UINT32_MAX = 4_294_967_295n;

export function computeUtilisationBps(committed: bigint, backing: bigint): number {
  if (committed === 0n) return 0;
  if (backing === 0n) return Number(UINT32_MAX);
  const v = (committed * 10_000n) / backing;
  return v > UINT32_MAX ? Number(UINT32_MAX) : Number(v);
}

/** Convenience the UI uses: reserve ratio is the inverse view of utilisation. */
export function reserveRatioBps(committed: bigint, backing: bigint): number {
  if (committed === 0n) return 10_000;
  const v = (backing * 10_000n) / committed;
  return v > UINT32_MAX ? Number(UINT32_MAX) : Number(v);
}
