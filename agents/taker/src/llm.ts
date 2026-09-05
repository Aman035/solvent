/**
 * Provider-agnostic narration layer.
 *
 * The deterministic analyst (analyst.ts) makes every decision. This layer only turns
 * that analysis into prose, and it is entirely optional: with no key configured the
 * agent runs unchanged on the deterministic path. That is deliberate - a demo must not
 * depend on a network call to a third party mid-recording.
 *
 * Configure with LLM_PROVIDER + the matching key:
 *   anthropic | openai | gemini | groq | xai | ollama   (ollama needs no key)
 */
import type { Assessment } from "./analyst.js";

export interface LlmConfig { provider: string; model: string; apiKey?: string; baseUrl?: string }

export function llmConfig(): LlmConfig | null {
  const provider = (process.env.LLM_PROVIDER ?? "").toLowerCase();
  if (!provider) return null;
  const map: Record<string, { env: string; model: string; url: string }> = {
    anthropic: { env: "ANTHROPIC_API_KEY", model: "claude-opus-5", url: "https://api.anthropic.com/v1/messages" },
    openai:    { env: "OPENAI_API_KEY",    model: "gpt-4o-mini",  url: "https://api.openai.com/v1/chat/completions" },
    gemini:    { env: "GEMINI_API_KEY",    model: "gemini-2.0-flash", url: "https://generativelanguage.googleapis.com/v1beta/models" },
    groq:      { env: "GROQ_API_KEY",      model: "llama-3.3-70b-versatile", url: "https://api.groq.com/openai/v1/chat/completions" },
    xai:       { env: "XAI_API_KEY",       model: "grok-2-latest", url: "https://api.x.ai/v1/chat/completions" },
    ollama:    { env: "",                  model: process.env.OLLAMA_MODEL ?? "llama3.1", url: "http://localhost:11434/api/chat" },
  };
  const cfg = map[provider];
  if (!cfg) return null;
  const apiKey = cfg.env ? process.env[cfg.env] : undefined;
  if (cfg.env && !apiKey) return null;             // key required but absent -> stay deterministic
  return { provider, model: process.env.LLM_MODEL ?? cfg.model, apiKey, baseUrl: cfg.url };
}

export function buildPrompt(assessments: Assessment[], chosen: Assessment | null): string {
  const rows = assessments.map((a) => ({
    agent: a.agent, score: a.score.toString(), honoredUsd: a.honoredUsd,
    reliabilityBps: a.reliabilityBps, verdict: a.verdict,
    flags: a.flags.map((f) => `${f.code}(${f.severity}): ${f.detail}`),
  }));
  return [
    "You are a counterparty risk analyst for an on-chain trading agent.",
    "Below is analysis derived from live indexed blockchain data: ERC-8004 reputation",
    "reviews joined to the actual record of honoured trades on 1inch Aqua.",
    "",
    JSON.stringify({ candidates: rows, selected: chosen?.agent ?? null }, null, 2),
    "",
    "In at most three sentences, explain why the selected counterparty is the right choice",
    "and what specifically disqualifies the others. Cite concrete numbers. Do not invent",
    "any figure that is not present above. Plain prose, no preamble.",
  ].join("\n");
}

/** Returns narration, or null if unavailable/failed. Never throws. */
export async function narrate(assessments: Assessment[], chosen: Assessment | null): Promise<string | null> {
  const cfg = llmConfig();
  if (!cfg) return null;
  const prompt = buildPrompt(assessments, chosen);
  try {
    const ctl = AbortSignal.timeout(20_000);
    let res: Response, text: string;

    if (cfg.provider === "anthropic") {
      res = await fetch(cfg.baseUrl!, {
        method: "POST", signal: ctl,
        headers: { "content-type": "application/json", "x-api-key": cfg.apiKey!, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: cfg.model, max_tokens: 400, messages: [{ role: "user", content: prompt }] }),
      });
      const j: any = await res.json();
      text = j?.content?.map((c: any) => c.text).join("") ?? "";
    } else if (cfg.provider === "ollama") {
      res = await fetch(cfg.baseUrl!, {
        method: "POST", signal: ctl, headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: cfg.model, stream: false, messages: [{ role: "user", content: prompt }] }),
      });
      const j: any = await res.json();
      text = j?.message?.content ?? "";
    } else if (cfg.provider === "gemini") {
      res = await fetch(`${cfg.baseUrl}/${cfg.model}:generateContent?key=${cfg.apiKey}`, {
        method: "POST", signal: ctl, headers: { "content-type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      });
      const j: any = await res.json();
      text = j?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("") ?? "";
    } else {
      // OpenAI-compatible: openai, groq, xai
      res = await fetch(cfg.baseUrl!, {
        method: "POST", signal: ctl,
        headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}` },
        body: JSON.stringify({ model: cfg.model, max_tokens: 400, messages: [{ role: "user", content: prompt }] }),
      });
      const j: any = await res.json();
      text = j?.choices?.[0]?.message?.content ?? "";
    }
    const out = (text ?? "").trim();
    return out.length > 0 ? out : null;
  } catch {
    return null;                                    // degrade silently to deterministic prose
  }
}
