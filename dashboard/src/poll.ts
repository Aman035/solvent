/**
 * Polling that respects shared, rate-limited public endpoints.
 * Hidden tabs cost nothing (judges leave tabs open for hours); a 429 doubles the
 * interval up to 8x and the first success snaps it back.
 */
export class RateLimited extends Error {
  constructor() { super("rate limited, backing off"); this.name = "RateLimited"; }
}

/** Gateway URL -> the Studio URL for the same subgraph, used if the gateway fails. */
export const FALLBACK = new Map<string, string>();

async function postOnce<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  if (r.status === 429) throw new RateLimited();
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = (await r.json()) as { data?: unknown; errors?: { message: string }[] };
  // the gateway reports quota, auth and indexer problems as errors with no data
  if (j.errors?.length && !j.data) throw new Error(j.errors[0].message);
  return j as T;
}

/**
 * The gateway key has a monthly quota shared by every visitor. Each browser may spend
 * at most this many gateway queries per day; past it, that browser reads Studio.
 */
const DAILY_GATEWAY_CAP = 400;

function takeGatewayQuery(): boolean {
  try {
    const key = `solvent-gw-${new Date().toISOString().slice(0, 10)}`;
    const used = Number(localStorage.getItem(key) ?? 0);
    if (used >= DAILY_GATEWAY_CAP) return false;
    localStorage.setItem(key, String(used + 1));
    return true;
  } catch { return true; }   // storage blocked: the idle pause still bounds usage
}

export async function postJSON<T>(url: string, body: unknown): Promise<T> {
  const studio = FALLBACK.get(url);
  if (studio && !takeGatewayQuery()) return await postOnce<T>(studio, body);
  try { return await postOnce<T>(url, body); }
  catch (e) {
    if (!studio) throw e;
    return await postOnce<T>(studio, body);
  }
}

// ── idle: a forgotten tab that is still visible must not poll forever ──
const IDLE_MS = 5 * 60_000;
let lastActive = Date.now();
const wakers = new Set<() => void>();
export const isIdle = () => Date.now() - lastActive > IDLE_MS;
function markActive() {
  const wasIdle = isIdle();
  lastActive = Date.now();
  if (wasIdle) for (const wake of [...wakers]) wake();
}
if (typeof window !== "undefined")
  for (const ev of ["pointerdown", "pointermove", "keydown", "wheel", "scroll", "touchstart"])
    window.addEventListener(ev, markActive, { passive: true });

export function startPoll(fn: () => Promise<void>, ms: number): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false, inflight = false, delay = ms;
  const onWake = () => { wakers.delete(onWake); if (!stopped && !document.hidden) run(); };
  const schedule = () => {
    clearTimeout(timer);
    if (stopped || document.hidden) return;
    if (isIdle()) { wakers.add(onWake); return; }
    timer = setTimeout(run, delay);
  };
  const run = async () => {
    if (stopped || inflight) return;
    inflight = true;
    try { await fn(); delay = ms; }
    catch (e) { delay = e instanceof RateLimited ? Math.min(delay * 2, ms * 8) : ms; }
    finally { inflight = false; }
    schedule();
  };
  const onVisibility = () => { if (document.hidden) clearTimeout(timer); else run(); };
  document.addEventListener("visibilitychange", onVisibility);
  run();
  return () => { stopped = true; clearTimeout(timer); wakers.delete(onWake); document.removeEventListener("visibilitychange", onVisibility); };
}
