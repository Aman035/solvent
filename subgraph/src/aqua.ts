import { Address, Bytes } from "@graphprotocol/graph-ts";
import { Shipped, Docked, Pulled, Pushed } from "../generated/Aqua/Aqua";
import { Strategy } from "../generated/schema";
import { loadAgent, ZERO } from "./shared";
import { touch, release, tokensFromShipInput } from "./books";

/**
 * Extract the raw SwapVM program from Aqua's `strategy` blob.
 *
 * The blob is `abi.encode(ISwapVM.Order)`, laid out as:
 *   [0..31]    offset to the tuple            (0x20)
 *   [32..63]   maker
 *   [64..95]   makerTraits
 *   [96..127]  offset to `data`               (0x60)
 *   [128..159] length of `data`
 *   [160..]    data = tokenA(20) ++ tokenB(20) ++ program
 *
 * Walking the blob directly as an instruction stream - as an earlier version did -
 * reads ABI padding as opcodes and silently reports the wrong instructions.
 */
function extractProgram(strategy: Bytes): Bytes {
  const DATA_START = 160;
  const TOKENS = 40;
  if (strategy.length < DATA_START + TOKENS) return Bytes.empty();

  // data length lives in the last 4 bytes of the 32-byte word at [128..159]
  let len = 0;
  for (let i = 156; i < 160; i++) len = (len << 8) | strategy[i];
  if (len <= TOKENS || DATA_START + len > strategy.length) return Bytes.empty();

  return Bytes.fromUint8Array(strategy.subarray(DATA_START + TOKENS, DATA_START + len));
}

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

  let prog = extractProgram(event.params.strategy);
  s.program = prog;
  s.hasReputationGate = programHasOpcode(prog, 0x21);
  s.hasPriceAdjuster = programHasOpcode(prog, 0xb3);

  // learn the token list from the ship calldata (wrapper ships are picked up lazily
  // on their first pull/push instead) and initialise the maker's book from chain state
  let shippedTokens = tokensFromShipInput(event.transaction.input);
  let tokenBytes: Array<Bytes> = [];
  for (let i = 0; i < shippedTokens.length; i++) {
    tokenBytes.push(shippedTokens[i]);
    touch(event.address, event.params.maker, event.params.app, event.params.strategyHash, shippedTokens[i], event.block);
  }
  s.tokens = tokenBytes;
  s.committed = [];
  s.active = true;
  s.shippedAtBlock = event.block.number;
  s.shippedTx = event.transaction.hash;
  s.save();
}

export function handlePulled(event: Pulled): void {
  trackStrategyToken(event.params.strategyHash, event.params.token);
  touch(event.address, event.params.maker, event.params.app, event.params.strategyHash, event.params.token, event.block);
}

export function handlePushed(event: Pushed): void {
  trackStrategyToken(event.params.strategyHash, event.params.token);
  touch(event.address, event.params.maker, event.params.app, event.params.strategyHash, event.params.token, event.block);
}

/** Keep Strategy.tokens complete even for wrapper ships discovered lazily. */
function trackStrategyToken(hash: Bytes, token: Bytes): void {
  let s = Strategy.load(hash);
  if (s == null) return;
  let toks = s.tokens;
  for (let i = 0; i < toks.length; i++) {
    if (toks[i].equals(token)) return;
  }
  toks.push(token);
  s.tokens = toks;
  s.save();
}

export function handleDocked(event: Docked): void {
  let s = Strategy.load(event.params.strategyHash);
  if (s == null) return;
  s.active = false;
  s.dockedAtBlock = event.block.number;
  s.save();

  let toks = s.tokens;
  for (let i = 0; i < toks.length; i++) {
    release(event.address, event.params.maker, event.params.strategyHash, Address.fromBytes(toks[i]), event.block);
  }
}
