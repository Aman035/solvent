# Demo script — shot by shot

**Target 3:00, hard ceiling 4:00.** Record in segments and edit; do **not** attempt one
live take across a testnet.

## Before you press record

```bash
pnpm dash:preview          # terminal 1 — leave running, browser at localhost:4173
pnpm demo:check            # terminal 2 — must print CLEAR TO RECORD
```

If `demo:check` fails it tells you the exact command to fix it. The most common one is a
lagging subgraph — wait, don't record.

**Screen layout:** browser left (~60%), terminal right (~40%). Terminal font ≥ 16pt.
Browser at 1920×1080, zoom 100%.

**The four mandatory beats.** If any is missing from the final cut, re-record:
1. ✅ an on-chain token transfer with the explorer open *(1inch)*
2. ✅ the custom SwapVM instruction doing something *(1inch)*
3. ✅ the Subgraph Studio page and an API-keyed query *(The Graph)*
4. ✅ the agent reasoning over that data before acting *(The Graph)*

---

## 0:00 – 0:25 · The problem

**Screen:** dashboard, full page.

> "Two agents. Identical reputations — five stars, twenty reviewers each. One of them has
> never delivered anything."

Point at the Alice and Mallory rows. Both have the same rank of grey ticks.

> "The grey ticks are reviews. They're identical because reviews *are* identical — anyone
> can give anyone five stars, with no stake and no prior interaction. A July study found
> nine in ten reviewers on Base are Sybils."

Click **Mallory's row** → the drawer opens.

> "Here's every one of her twenty reviewers. Each is a real transaction you can click. They
> cost twenty-nine cents in total, and none of them ever traded with her."

Close the drawer. Point at the green channel on Alice versus Mallory's empty dashed one.

> "The green is value actually delivered. That's the only thing here that cost anything."

---

## 0:25 – 1:05 · What can't be faked  ·  **BEAT 1 + 3**

**Screen:** terminal.

```bash
pnpm alice status
```

> "Alice is a market maker on 1inch Aqua. She's committed twenty thousand USDC and ten
> WETH — but look: the tokens are still in her wallet. Aqua is a ledger, not a vault. It
> never took custody."

**Screen:** switch to the Subgraph Studio page, then the query endpoint. ← **BEAT 3**

> "Every ship, every fill, and every ERC-8004 review is indexed by The Graph. This subgraph
> joins two things nobody had joined before: what an agent *claims* to be, and what it has
> actually *done*."

Run a query in the browser showing agents with reviewCount and honoredCount side by side.

---

## 1:05 – 1:50 · The agent decides  ·  **BEAT 4 + 1**

**Screen:** terminal.

```bash
pnpm bob 500
```

Let the output render fully. Point at the flag line.

> "Bob queries that subgraph live. He sees Mallory's twenty perfect reviews and flags them —
> `REVIEW_DELIVERY_DIVERGENCE`, twenty reviews averaging five out of five, and zero
> delivery. That flag only exists because both sides are indexed. Delete The Graph and he
> can't produce it."

> "He picks Alice, and swaps."

**Screen:** click the transaction link → BaseScan. ← **BEAT 1**

> "Real WETH leaving Alice's own wallet. No vault, no deposit — a market maker settling
> from her own inventory."

---

## 1:50 – 2:20 · The gate  ·  **BEAT 2**

**Screen:** terminal.

```bash
pnpm demo:run 2
```

> "Alice's strategy carries a custom SwapVM instruction we wrote — `ReputationGate`,
> opcode 0x21. Bob has a track record, so he's admitted."

Point at the refusal.

> "This taker has no record. Refused — at *quote* time, before a single unit of gas is
> spent on a swap. `TakerBelowReputationFloor`, score zero, floor one thousand."

> "That's a maker enforcing counterparty reputation inside the swap itself."

---

## 2:20 – 2:50 · The broken promise

**Screen:** terminal.

```bash
pnpm alice betray
```

> "Because Aqua never took custody, Alice can simply move her inventory out. Her Aqua
> position still advertises the same liquidity."

```bash
pnpm exec tsx scripts/betray-flow.ts
```

> "The next taker gets a revert. Status: reverted. Zero logs — a failed transaction
> destroys its own record, which is exactly why a subgraph can't see it on its own."

Click the reverted transaction → BaseScan.

> "But it's permanently on the explorer. Our attestor scans for it and puts it back
> on-chain, citing that transaction hash."

**Screen:** dashboard, refreshed.

> "Alice's row now reads *one returned*. Her score fell from five-nine-eight-three to
> four-nine-four-two — twenty percent, for one broken promise. Her review score didn't
> move at all. Still five stars."

---

## 2:50 – 3:00 · Close

**Screen:** dashboard, cost panel.

> "A perfect review score costs twenty-nine cents and zero capital. Manufacturing the
> equivalent in fills took forty-five thousand dollars of real inventory. And a maker that
> only trades with itself scores zero, however much volume it writes."

> "Reputation you had to pay for. Built on 1inch Aqua and The Graph."

**End card:** repo URL · subgraph URL · router address.

---

## After recording

```bash
pnpm demo:reset      # restores Alice's inventory and tops up gas
```

The failed fill stays on the record permanently. That's the system working, not a
leftover to clean up.
