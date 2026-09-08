# @aqua-solvent/core

SDK for [Solvent](https://github.com/Aman035/solvent): solvency-aware market making
on 1inch Aqua. Query every Aqua maker's live balance sheet on four chains, build
SwapVM programs that price their own solvency risk, and read the settlement score.

## Install

```bash
npm i @aqua-solvent/core
```

## Read any maker's balance sheet (no keys, no config)

```ts
import { createSolvent, SolventChain } from "@aqua-solvent/core";

const solvent = createSolvent({ chain: SolventChain.Base });

const books = await solvent.books.top(10);
for (const b of books) {
  console.log(b.maker, b.token, `${b.utilisationBps / 100}% utilised`,
    `promised ${b.committed} backed ${b.backing}`);
}
```

Base, Arbitrum, and Optimism watch the official 1inch Aqua deployment and are
**read-only today**: the index is live, the contracts are coming. Base Sepolia is
**full mode**: contracts, quoting, and the index.

| Chain | Mode | What works |
| --- | --- | --- |
| `SolventChain.BaseSepolia` | full | books, contracts, strategy builder, quoting |
| `SolventChain.Base` | read-only | books, index health |
| `SolventChain.Arbitrum` | read-only | books, index health |
| `SolventChain.Optimism` | read-only | books, index health |

Anything needing contracts on a read-only chain throws `ReadOnlyChainError`.

## Build a self-defending strategy (full-mode chains)

```ts
const sepolia = createSolvent({ chain: SolventChain.BaseSepolia });

const program = sepolia.strategy()
  .solvencyFloor(9_500)          // refuse to quote above 95% utilisation
  .solvencySkew(5_000, 400_000)  // widen up to 4% as the wallet thins past 50%
  .xyc()                         // constant-product pricing
  .fee(30_000)                   // 0.30% base fee
  .encode();                     // SwapVM bytecode, ready to ship() on Aqua
```

The oracle addresses are filled in per chain; `sepolia.contracts` has the full
deployment (router, SolventBook, score, all verified on Basescan).

## Overrides

```ts
createSolvent({
  chain: SolventChain.Base,
  rpcUrl: "https://your-endpoint",         // default: public RPC
  subgraphUrl: "https://your-gateway-url", // default: public Studio endpoint
});
```

## Utilities

`computeUtilisationBps`, `computeScore`, and the raw instruction encoders are
exported directly, bit-exact against the Solidity contracts (1009-case
differential suite in the main repo).
