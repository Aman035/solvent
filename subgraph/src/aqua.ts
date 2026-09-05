import { Bytes } from "@graphprotocol/graph-ts";
import { Shipped, Docked } from "../generated/Aqua/Aqua";
import { Strategy } from "../generated/schema";
import { loadAgent, ZERO } from "./shared";

/** Opcode 0x21 - ReputationGate. Opcode 0xb3 - ReputationPriceAdjuster. */
function programHasOpcode(program: Bytes, opcode: i32): boolean {
  // Walk the [opcode][argsLen][args] stream rather than substring-matching, so an
  // argument byte that happens to equal the opcode cannot produce a false positive.
  let i = 0;
  while (i + 1 < program.length) {
    let op = program[i];
    let len = program[i + 1];
    if (op == opcode) return true;
    i += 2 + len;
  }
  return false;
}

export function handleShipped(event: Shipped): void {
  let maker = loadAgent(event.params.maker, event.block);
  maker.save();

  let s = new Strategy(event.params.strategyHash);
  s.maker = maker.id;
  s.app = event.params.app;

  // The Aqua `strategy` blob is abi.encode(ISwapVM.Order). The program bytes are the
  // last dynamic field; we store the whole blob and let consumers decode. The opcode
  // scan below is a heuristic over that blob and is used only for UI chips.
  s.program = event.params.strategy;
  s.hasReputationGate = programHasOpcode(event.params.strategy, 0x21);
  s.hasPriceAdjuster = programHasOpcode(event.params.strategy, 0xb3);

  s.tokens = [];
  s.committed = [];
  s.active = true;
  s.shippedAtBlock = event.block.number;
  s.shippedTx = event.transaction.hash;
  s.save();
}

export function handleDocked(event: Docked): void {
  let s = Strategy.load(event.params.strategyHash);
  if (s == null) return;
  s.active = false;
  s.dockedAtBlock = event.block.number;
  s.save();
}
