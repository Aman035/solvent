# Submission Checklist — ETHGlobal Online 2026

## Deadline

| | |
| --- | --- |
| **Project submissions due** | **Sunday 13 Sep 2026, 21:30 IST** |
| In UTC | **16:00 UTC, Sun 13 Sep 2026** |
| Video length | **~4 minutes maximum** (target 3:00, hard ceiling 4:00) |
| **Internal target** | **Fri 12 Sep, end of day** — leaves Sun 13 as pure buffer |

Do not plan to finish on the 13th. Recording and both submission forms are the two things that always overrun.

### Countdown from 5 Sep

| Day | Date | Phase |
| --- | --- | --- |
| 0 | Fri 5 Sep | ✅ Phase 0 verification (done) |
| 1 | Sat 6 Sep | Phase 1 foundations + Phase 2 start |
| 2 | Sun 7 Sep | Contracts: gate, router, encoder |
| 3 | Mon 8 Sep | **Vertical slice (C12)** |
| 4 | Tue 9 Sep | Subgraph + failed-fill pipeline |
| 5 | Wed 10 Sep | Attestor + agents + LLM |
| 6 | Thu 11 Sep | Cost-to-fake + dashboard |
| 7 | Fri 12 Sep | Dashboard polish, orchestration, **2 dry runs**, docs |
| 8 | Sat 12–13 Sep | **Video + submit** |
| — | Sun 13 Sep 21:30 IST | **HARD DEADLINE** |

---

## 1inch — "Build an Aqua App" ($5,000: 2,500 / 1,500 / 1,000)

- [ ] Official Aqua contracts used — `new Aqua()` from pinned `1inch/aqua`, redeployed unmodified to Base Sepolia
- [ ] Provenance documented: submodule SHA, solc version, optimizer settings, deployed-vs-local bytecode equality
- [ ] Modified SwapVM redeployed — `ProofOfFillSwapVMRouter` with `ReputationGate` appended (permitted "redeployment of a modified SwapVM")
- [ ] Custom instruction highlighted: `ReputationGate` at reserved slot `0x21` in the guards bank
- [ ] Regression evidence: upstream opcode indices unchanged; stock program quotes identically
- [ ] On-chain token transfer shown in the demo with the explorer open
- [ ] Contracts **verified on BaseScan** (needs `BASESCAN_API_KEY`)
- [ ] Proper git history — no single-commit final-day dump (≥60 commits across ≥8 days)
- [ ] Attribution preserved: "Powered by Aqua — © Degensoft Ltd", "Powered by SwapVM — © Degensoft Ltd", `LICENSES/` intact

## The Graph — "Best AI Tooling or AI Use Case (From Scratch)" ($5,000: 2,500 / 1,500 / 1,000)

- [ ] The Graph is load-bearing — delete it and Bob cannot score anyone (proved by C21's ablation test)
- [ ] Live data from Subgraph Studio with an API key; **no mocked/local/static data anywhere**
- [ ] Studio page shown on camera; API-keyed query visible
- [ ] Meaningful work with the data: LLM risk analysis + counterparty decision + real on-chain execution
- [ ] **Repo public** with a README a judge can run  ⚠️ *currently PRIVATE — must flip before 13 Sep*
- [ ] "Start Fresh" pool selected on the submission form
- [ ] README states no pre-existing project code was used
- [ ] Video 2–4 min

## The one video, both rubrics

All four must be visibly present or re-record:

- [ ] (1inch) An on-chain token transfer with the explorer open
- [ ] (1inch) The custom SwapVM instruction doing something — `TakerBelowReputationFloor` revert
- [ ] (Graph) The Subgraph Studio page and an API-keyed query
- [ ] (Graph) The agent reasoning over that data before acting

Plus our differentiator beat:
- [ ] The measured cost-to-fake table (C22) — reviews vs Proof of Fill

---

## Ready to submit — evidence

| Requirement | Evidence |
| --- | --- |
| Official Aqua, unmodified | `0x525bebb9c5b4dad791402923e344b360bf6ab6a2` — verified, deployed from pinned `1inch/aqua@9c5c42e` |
| Modified SwapVM redeployed | `0x06ac5984d1bdd04aefd3e4e33312f30ce058462e` — `PROOF_OF_FILL_OPCODE_COUNT = 2` |
| Custom instruction working | `TakerBelowReputationFloor` reverts on-chain, refuses at quote time |
| Upstream unaffected | 35 of 1inch's own Aqua tests pass against our router |
| On-chain token transfer | `Swapped` + Aqua `Pulled`, WETH leaving the maker's wallet |
| Contracts verified | all 11 on BaseScan |
| Git history | 30+ commits across the build, all signed, CI green |
| The Graph load-bearing | `REVIEW_DELIVERY_DIVERGENCE` needs the ERC-8004↔Aqua join |
| Live Studio data | subgraph v0.4.0, API-keyed, no mocks anywhere |
| Meaningful work | agent queries → analyses → decides → executes |
| Open source + README | README.md with runnable quickstart |
| Start Fresh | declared in README; no pre-existing project code |

## Credentials status

| Item | Status | Needed for |
| --- | --- | --- |
| Base Sepolia RPC (QuickNode) + fallback | ✅ in `.env` | everything |
| `GRAPH_DEPLOY_KEY` | ✅ in `.env` | subgraph deploy |
| `GRAPH_API_KEY` | ✅ in `.env` | gateway queries |
| GitHub repo | ✅ `Aman035/proof-of-fill` (private) | submission |
| Funded deployer key / mnemonic | ✅ in `.env` | all deployment |
| `BASESCAN_API_KEY` | ✅ in `.env` | contract verification |
| LLM provider key | ⚪ optional | narration only; agent runs fully without it |
| Repo public | ⏳ before 13 Sep | Graph requirement |
