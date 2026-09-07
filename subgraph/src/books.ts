import { Address, BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts";
import { Aqua } from "../generated/Aqua/Aqua";
import { ERC20 } from "../generated/Aqua/ERC20";
import { MakerBook, StrategyToken } from "../generated/schema";

/**
 * Maker balance-sheet maintenance.
 *
 * Design: NO delta replay. On every touch of a (strategy, token) pair the mapping reads
 * Aqua.rawBalances at the block being indexed, which is exact by construction and
 * immune to ordering subtleties, wrapper ships and hash edge cases. Calldata decoding
 * exists only to learn a strategy's token list at ship time; when the ship came through
 * a wrapper the pair is picked up lazily on its first Pulled/Pushed instead (the
 * analyzer proved this covers 442 of 443 real strategies).
 */

const SHIP_SELECTOR = "f50b870f";
const BPS = BigInt.fromI32(10_000);
const U32_MAX = BigInt.fromU64(4_294_967_295);

export function utilisationBps(committed: BigInt, backing: BigInt): BigInt {
  if (committed.isZero()) return BigInt.zero();
  if (backing.isZero()) return U32_MAX;
  let v = committed.times(BPS).div(backing);
  return v.gt(U32_MAX) ? U32_MAX : v;
}

function stId(hash: Bytes, token: Bytes): Bytes {
  return hash.concat(token);
}

function bookId(maker: Bytes, token: Bytes): Bytes {
  return maker.concat(token);
}

/** Re-read one strategy-token from the chain and fold the difference into the book. */
export function touch(
  aquaAddr: Address,
  maker: Address,
  app: Address,
  hash: Bytes,
  token: Address,
  block: ethereum.Block
): void {
  let aqua = Aqua.bind(aquaAddr);
  let raw = aqua.try_rawBalances(maker, app, hash, token);
  let current = raw.reverted ? BigInt.zero() : raw.value.value0;

  let sid = stId(hash, token);
  let st = StrategyToken.load(sid);
  let prev = BigInt.zero();
  if (st == null) {
    st = new StrategyToken(sid);
    st.strategyHash = hash;
    st.maker = maker;
    st.token = token;
  } else {
    prev = st.committed;
  }
  st.committed = current;
  st.save();

  let bid = bookId(maker, token);
  let book = MakerBook.load(bid);
  if (book == null) {
    book = new MakerBook(bid);
    book.maker = maker;
    book.token = token;
    book.committed = BigInt.zero();
    book.backing = BigInt.zero();
    book.utilisationBps = BigInt.zero();
  }
  book.committed = book.committed.plus(current).minus(prev);
  if (book.committed.lt(BigInt.zero())) book.committed = BigInt.zero();

  refreshBacking(book, maker, token, aquaAddr, block);
}

/**
 * backing = min(balance, allowance to Aqua): a revoked allowance is exactly as
 * unfillable as an empty wallet. Every path that stamps updatedAtBlock re-reads
 * backing so all book fields describe the same block.
 */
function refreshBacking(book: MakerBook, maker: Address, token: Address, aquaAddr: Address, block: ethereum.Block): void {
  let erc = ERC20.bind(token);
  let bal = erc.try_balanceOf(maker);
  let alw = erc.try_allowance(maker, aquaAddr);
  let b = bal.reverted ? BigInt.zero() : bal.value;
  let a = alw.reverted ? BigInt.zero() : alw.value;
  book.backing = b.lt(a) ? b : a;

  book.utilisationBps = utilisationBps(book.committed, book.backing);
  book.updatedAtBlock = block.number;
  book.save();
}

/** Zero a strategy-token after a dock and fold the release into the book. */
export function release(aquaAddr: Address, maker: Address, hash: Bytes, token: Address, block: ethereum.Block): void {
  let st = StrategyToken.load(stId(hash, token));
  if (st == null || st.committed.isZero()) {
    if (st != null) {
      st.committed = BigInt.zero();
      st.save();
    }
    return;
  }
  let book = MakerBook.load(bookId(maker, token));
  if (book != null) {
    book.committed = book.committed.minus(st.committed);
    if (book.committed.lt(BigInt.zero())) book.committed = BigInt.zero();
    // a dock is a touch: re-read backing so the book is consistent at this block
    refreshBacking(book, maker, token, aquaAddr, block);
  }
  st.committed = BigInt.zero();
  st.save();
}

/** Token list from ship() calldata, when the ship was a direct call. */
export function tokensFromShipInput(input: Bytes): Array<Address> {
  let out = new Array<Address>();
  if (input.length < 4 + 32 * 4) return out;
  let sel = input.subarray(0, 4);
  let selHex = Bytes.fromUint8Array(sel).toHexString().slice(2);
  if (selHex != SHIP_SELECTOR) return out;

  let data = Bytes.fromUint8Array(input.subarray(4));
  // decode the calldata as a tuple; function args are encoded exactly like one
  let decoded = ethereum.decode("(address,bytes,address[],uint256[])", data);
  if (decoded == null) return out;
  let tuple = decoded.toTuple();
  let tokens = tuple[2].toAddressArray();
  for (let i = 0; i < tokens.length; i++) out.push(tokens[i]);
  return out;
}
