/**
 * Polling that respects shared, rate-limited public endpoints.
 * Hidden tabs cost nothing (judges leave tabs open for hours); a 429 doubles the
 * interval up to 8x and the first success snaps it back.
 */
export class RateLimited extends Error {
  constructor() { super("rate limited, backing off"); this.name = "RateLimited"; }
}

export async function postJSON<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  if (r.status === 429) throw new RateLimited();
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()) as T;
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
