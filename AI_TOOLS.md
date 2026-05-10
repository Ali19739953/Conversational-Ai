# Arlo — AI Tools, Tradeoffs & Caveats

A short brief on the prototype: a mental-wellness chat companion (Vite + React frontend, Express backend, Groq LLM) with server-enforced rate limiting and guardrails.

---

## AI tools used

| Tool | Where | Why |
|---|---|---|
| **Groq Cloud** (`openai/gpt-oss-20b`) via direct `fetch` to `https://api.groq.com/openai/v1/chat/completions` | `backend/groqClient.js`, `backend/server.js` | Cheap, very low-latency inference. We hit Groq's HTTP API directly with `fetch` — no SDK dependency, no vendor SDK to track. |
| **System prompt** (`backend/systemPrompt.js`) | Prepended server-side on every call | Defines role (companion, not therapist), style, hard rules, crisis flow, and out-of-scope handling. Lives on the server so a client cannot override it. |
| **Regex input/output guardrails** (`backend/guardrails.js`) | Pre- and post-LLM | Crisis detection, prompt-injection blocking, scope deflection, PII redaction, post-LLM diagnosis filter. Cheap, deterministic, no extra inference cost. |
| **In-memory sliding-window rate limiter** (`backend/rateLimit.js`) | Express middleware on `/api/chat` | Per-IP: 10/min and 200/day. No Redis dependency for the prototype. |
| **Helmet + CORS allowlist + 32 KB JSON cap** | `backend/server.js` | Standard hardening on top of the LLM-specific guardrails. |

---

## Tradeoffs

**Regex guardrails over an LLM-judge / moderation API.** Fast, free, predictable, easy to audit. They miss paraphrases ("I want to disappear forever") and obfuscated injection. A second-pass classifier (e.g. OpenAI moderation, Llama Guard, or a small Groq call) would catch more — at the cost of latency, cost, and a second failure mode.

**In-memory rate limiter over Redis.** One file, zero infra. Resets on restart and doesn't share state across instances — fine for a single-process prototype, wrong for production. Swap for `rate-limiter-flexible` + Redis when horizontal scaling matters.

**Per-IP keying.** Easy and works for demos. Trivially defeated by NAT (one user blocks a household) or rotating IPs (one attacker bypasses). Production needs a per-user/account key plus IP as a secondary signal.

**Crisis flow returns a hard-coded response, bypassing the LLM.** Removes the chance of the model producing harmful "advice" in the worst moments. The cost is no personalization in that exact reply; the user can still continue the conversation afterwards and the LLM picks up from there.

**Server owns the system prompt and model.** Clients no longer pass `system`/`model` (the original code did). Eliminates a class of injection/abuse, slightly less flexible for A/B testing.

**Groq's `openai/gpt-oss-20b`.** Fast and cheap, good general behavior. Smaller than frontier models — occasionally less nuanced on complex emotional topics. The system prompt does heavy lifting to keep it safe and on-tone.

---

## Security & prototype notes

- **Secrets:** `GROQ_API_KEY` lives in `backend/.env`, never reaches the browser.
- **Allowlisted CORS origin** (`DEV_ORIGIN`), `helmet()` defaults, `x-powered-by` disabled, request body capped at 32 KB.
- **Defense in depth:** client preflight regex (UX) → server preflight regex (enforced) → system prompt rules → output regex (post-hoc).
- **PII redaction** of obvious SSN/credit-card/email patterns before the message is sent to Groq, so a leak in upstream logs is less damaging.
- **Trust boundary:** anything inside a user message is treated as untrusted data, not instructions. The system prompt explicitly tells the model this.
- **Logging:** the prototype does not persist conversations. Production must decide where transcripts live and for how long, and disclose it in a privacy notice.

---

## Caveats

- **Not a clinical product.** No HIPAA / GDPR review. No clinician in the loop. The wording in the empty state and system prompt makes that clear, but it is the operator's job to keep it that way.
- **Crisis detection is conservative, not exhaustive.** Real users express distress in ways no regex catches. The system prompt is the second line; a human escalation path is the third (and is missing here).
- **Rate limits are per-IP and in-process.** Bypassable and not durable. Costs are bounded but not strongly bounded.
- **No authentication.** Anyone who can hit the backend can talk to the bot. Fine for local dev, not for the open internet.
- **No streaming.** Responses arrive as a single block; long replies feel slow.
- **No transcript persistence or admin review.** A safety incident can't be reviewed after the fact.

---

## What I'd improve next

1. **Authenticated users + per-account quotas** (Redis-backed token bucket). Cleanly separates abuse limits from cost limits.
2. **LLM-based moderation as a second pass** (Llama Guard on Groq, or OpenAI moderation) for both inputs and outputs — wired in only when the regex layer flags ambiguous cases, to keep latency down.
3. **Streaming responses** (`stream: true` on Groq) for perceived latency and the ability to early-cancel if the output guardrail trips mid-stream.
4. **Structured crisis escalation:** offer to text a trusted contact, surface localized hotline numbers based on a user-set region, log the event for a human to review.
5. **Eval harness:** a small fixed set of red-team prompts (jailbreaks, crisis paraphrases, off-topic) run on every PR so we catch regressions in the system prompt.
6. **Observability:** request-level structured logs (no message content), guardrail-trip counters, latency/error dashboards. Today there's nothing.
7. **Cost cap:** a hard daily token-spend ceiling per account *and* globally, returning 503 with a friendly message when hit, so a billing accident can't compound.
8. **Privacy controls:** end-of-session "delete this conversation" button; clear retention policy.
