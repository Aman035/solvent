import { describe, it, expect } from "vitest";
import { program, decode, OPCODE, ProgramOrderError } from "../src/program.js";

const ORACLE = "0x95908bb174224f085b0f30d6236a46b27c7a6711";

describe("ProgramBuilder", () => {
  it("encodes [opcode][argsLen][args]", () => {
    expect(program().xyc().encode()).toBe("0x5000");
    expect(program().fee(30_000).encode()).toBe("0x7003007530");
  });

  it("round-trips through decode()", () => {
    const p = program().gate(ORACLE, 100).widen(ORACLE, 1_000, 300_000).xyc().fee(30_000);
    const parts = decode(p.encode());
    expect(parts.map((x) => x.opcode)).toEqual([
      OPCODE.ReputationGate, OPCODE.ReputationPriceAdjuster, OPCODE.XYCSwap, OPCODE.FeeFlatIn,
    ]);
    expect(parts[0].args).toBe(`${ORACLE}00000064`);
  });

  it("rejects ReputationGate placed AFTER pricing", () => {
    expect(() => program().xyc().gate(ORACLE, 100))
      .toThrow(ProgramOrderError);
  });

  it("rejects ReputationPriceAdjuster placed AFTER pricing", () => {
    expect(() => program().xyc().widen(ORACLE, 1_000, 300_000))
      .toThrow(/must be placed BEFORE the pricing instruction/);
  });

  it("allows guards before pricing", () => {
    expect(() => program().gate(ORACLE, 100).widen(ORACLE, 1_000, 1).xyc()).not.toThrow();
  });

  it("rejects out-of-range rates", () => {
    expect(() => program().fee(1e7)).toThrow(/out of range/);
    expect(() => program().widen(ORACLE, 0, 1e7)).toThrow(/out of range/);
  });

  it("describes the program for the dashboard", () => {
    expect(program().gate(ORACLE, 100).xyc().fee(30_000).describe())
      .toEqual(["ReputationGate", "XYCSwap", "FeeFlatIn"]);
  });

  it("detects truncated programs", () => {
    expect(() => decode("0x2118aabb")).toThrow(/truncated/);
  });
});
