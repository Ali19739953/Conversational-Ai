const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_TIMEOUT_MS = 20_000;

export async function groqChat({
  model,
  messages,
  maxTokens,
  temperature,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  signal,
}) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("Missing GROQ_API_KEY");

  const ac = new AbortController();
  const onAbort = () => ac.abort(signal?.reason);
  signal?.addEventListener?.("abort", onAbort, { once: true });
  const timer = setTimeout(() => ac.abort(new Error("groq_timeout")), timeoutMs);

  let res;
  try {
    res = await fetch(GROQ_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature }),
      signal: ac.signal,
    });
  } catch (err) {
    if (err?.name === "AbortError" || /timeout/i.test(err?.message ?? "")) {
      const e = new Error("groq_timeout");
      e.code = "groq_timeout";
      throw e;
    }
    const e = new Error("groq_unreachable");
    e.code = "groq_unreachable";
    e.cause = err;
    throw e;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.("abort", onAbort);
  }

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const err = await res.json();
      detail = err?.error?.message || detail;
    } catch {}
    const e = new Error(detail);
    e.code = "groq_upstream";
    e.status = res.status;
    throw e;
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text || typeof text !== "string") {
    const e = new Error("groq_empty");
    e.code = "groq_empty";
    throw e;
  }
  return text;
}
