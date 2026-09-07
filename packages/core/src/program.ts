import { concatHex, pad, toHex, type Hex } from "viem";

/**
 * SwapVM program encoder.
 *
 * Wire format (see ContextLib.runLoop in 1inch swap-vm):
 *     [opcode:1][argsLength:1][args:argsLength] ...
 *
 * We hand-encode rather than use @1inch/swap-vm-sdk because the published SDK
 * (0.4.1) targets the LEGACY sequential opcode layout - it emits 0x11 for XYCSwap
 * where the pinned contracts expect 0x50. See docs/VERIFICATION_REPORT.md (V4).
 * Every opcode below is cross-checked against the Solidity libraries by
 * contracts/test/ProgramRoundTrip.t.sol.
 */

export const OPCODE = {
  Stop: 0x00,
  Salt: 0x02,
  Deadline: 0x20,
  /** ours - conditions & access guards bank */
  ReputationGate: 0x21,
  SolvencyFloor: 0x22,
  XYCSwap: 0x50,
  FeeFlatIn: 0x70,
  /** ours - rates tuning bank */
  ReputationPriceAdjuster: 0xb3,
  SolvencySkew: 0xb5,
} as const;

/** Instructions that compute swap amounts. Guards and wrappers must precede these. */
const PRICING_OPCODES: number[] = [OPCODE.XYCSwap];

export class ProgramOrderError extends Error {}

function ins(opcode: number, args: Hex = "0x"): Hex {
  const argBytes = (args.length - 2) / 2;
  if (argBytes > 255) throw new Error(`instruction args too long: ${argBytes}`);
  return concatHex([toHex(opcode, { size: 1 }), toHex(argBytes, { size: 1 }), args]);
}

const u = (v: number | bigint, size: number): Hex => pad(toHex(v), { size, dir: "left" });

export interface Instruction { opcode: number; bytes: Hex; name: string }

export const I = {
  stop: (): Instruction => ({ opcode: OPCODE.Stop, name: "Stop", bytes: ins(OPCODE.Stop) }),

  salt: (salt: bigint): Instruction =>
    ({ opcode: OPCODE.Salt, name: "Salt", bytes: ins(OPCODE.Salt, u(salt, 8)) }),

  deadline: (ts: number): Instruction =>
    ({ opcode: OPCODE.Deadline, name: "Deadline", bytes: ins(OPCODE.Deadline, u(ts, 5)) }),

  /** [address scoreOracle][uint32 floor] */
  reputationGate: (scoreOracle: Hex, floor: number): Instruction => ({
    opcode: OPCODE.ReputationGate, name: "ReputationGate",
    bytes: ins(OPCODE.ReputationGate, concatHex([pad(scoreOracle, { size: 20 }), u(floor, 4)])),
  }),

  /** [address scoreOracle][uint32 minScore][uint24 widenBps]  (widenBps denominated in 1e7) */
  reputationPriceAdjuster: (scoreOracle: Hex, minScore: number, widenBps: number): Instruction => {
    if (widenBps >= 1e7) throw new Error(`widenBps out of range: ${widenBps}`);
    return {
      opcode: OPCODE.ReputationPriceAdjuster, name: "ReputationPriceAdjuster",
      bytes: ins(OPCODE.ReputationPriceAdjuster,
        concatHex([pad(scoreOracle, { size: 20 }), u(minScore, 4), u(widenBps, 3)])),
    };
  },

  /** [address book][uint32 maxUtilisationBps] */
  solvencyFloor: (book: Hex, maxUtilisationBps: number): Instruction => ({
    opcode: OPCODE.SolvencyFloor, name: "SolvencyFloor",
    bytes: ins(OPCODE.SolvencyFloor, concatHex([pad(book, { size: 20 }), u(maxUtilisationBps, 4)])),
  }),

  /** [address book][uint32 startBps][uint24 maxWidenBps]  (widen denominated 1e7) */
  solvencySkew: (book: Hex, startBps: number, maxWidenBps: number): Instruction => {
    if (startBps >= 10_000 || maxWidenBps >= 1e7) throw new Error(`skew params out of range`);
    return {
      opcode: OPCODE.SolvencySkew, name: "SolvencySkew",
      bytes: ins(OPCODE.SolvencySkew,
        concatHex([pad(book, { size: 20 }), u(startBps, 4), u(maxWidenBps, 3)])),
    };
  },

  xycSwap: (): Instruction => ({ opcode: OPCODE.XYCSwap, name: "XYCSwap", bytes: ins(OPCODE.XYCSwap) }),

  /** feeBps denominated in 1e7, matching upstream FeeFlatIn */
  feeFlatIn: (feeBps: number): Instruction => {
    if (feeBps >= 1e7) throw new Error(`feeBps out of range: ${feeBps}`);
    return { opcode: OPCODE.FeeFlatIn, name: "FeeFlatIn", bytes: ins(OPCODE.FeeFlatIn, u(feeBps, 3)) };
  },
} as const;

export class ProgramBuilder {
  private readonly parts: Instruction[] = [];

  add(i: Instruction): this {
    // ReputationGate is validation-only and ReputationPriceAdjuster is a wrapper that
    // calls ctx.runLoop(); both are meaningless (or wrong) after the pricing instruction
    // has already computed amounts. Upstream warns instruction order is security-critical,
    // so this is enforced at build time rather than left to the caller.
    if (
      i.opcode === OPCODE.ReputationGate || i.opcode === OPCODE.ReputationPriceAdjuster ||
      i.opcode === OPCODE.SolvencyFloor || i.opcode === OPCODE.SolvencySkew
    ) {
      if (this.parts.some((p) => PRICING_OPCODES.includes(p.opcode))) {
        throw new ProgramOrderError(
          `${i.name} must be placed BEFORE the pricing instruction; found it after ` +
          `${this.parts.find((p) => PRICING_OPCODES.includes(p.opcode))!.name}`,
        );
      }
    }
    this.parts.push(i);
    return this;
  }

  gate(scoreOracle: Hex, floor: number) { return this.add(I.reputationGate(scoreOracle, floor)); }
  solvencyFloor(book: Hex, maxUtilisationBps: number) { return this.add(I.solvencyFloor(book, maxUtilisationBps)); }
  solvencySkew(book: Hex, startBps: number, maxWidenBps: number) { return this.add(I.solvencySkew(book, startBps, maxWidenBps)); }
  widen(scoreOracle: Hex, minScore: number, widenBps: number) { return this.add(I.reputationPriceAdjuster(scoreOracle, minScore, widenBps)); }
  xyc() { return this.add(I.xycSwap()); }
  fee(feeBps: number) { return this.add(I.feeFlatIn(feeBps)); }
  salt(s: bigint) { return this.add(I.salt(s)); }
  deadline(ts: number) { return this.add(I.deadline(ts)); }

  instructions(): readonly Instruction[] { return this.parts; }
  encode(): Hex { return concatHex(this.parts.map((p) => p.bytes)); }

  /** Human-readable chips for the dashboard: ["ReputationGate", "XYCSwap", "FeeFlatIn"] */
  describe(): string[] { return this.parts.map((p) => p.name); }
}

export function program(): ProgramBuilder { return new ProgramBuilder(); }

/** Decode a program back into (opcode, args) pairs - used to verify round-trips. */
export function decode(bytes: Hex): { opcode: number; args: Hex }[] {
  const b = bytes.slice(2);
  const out: { opcode: number; args: Hex }[] = [];
  let i = 0;
  while (i < b.length) {
    const opcode = parseInt(b.slice(i, i + 2), 16);
    const len = parseInt(b.slice(i + 2, i + 4), 16);
    const args = `0x${b.slice(i + 4, i + 4 + len * 2)}` as Hex;
    if (args.length - 2 !== len * 2) throw new Error(`truncated args at byte ${i / 2}`);
    out.push({ opcode, args });
    i += 4 + len * 2;
  }
  return out;
}
