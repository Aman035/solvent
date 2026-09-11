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

export async function postJSON<T>(url: string, body: unknown): Promise<T> {
  try { return await postOnce<T>(url, body); }
  catch (e) {
    const studio = FALLBACK.get(url);
    if (!studio) throw e;
    return await postOnce<T>(studio, body);
  }
}

export function startPoll(fn: () => Promise<void>, ms: number): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false, inflight = false, delay = ms;
  const schedule = () => {
    clearTimeout(timer);
    if (!stopped && !document.hidden) timer = setTimeout(run, delay);
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
  return () => { stopped = true; clearTimeout(timer); document.removeEventListener("visibilitychange", onVisibility); };
}
