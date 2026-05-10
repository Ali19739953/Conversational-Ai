## Arlo — Mental-Wellness Companion (Vite + React + Node + Groq)

A small full-stack chat prototype: a non-clinical mental-wellness companion with **server-enforced rate limiting and guardrails**.

- **Frontend**: Vite + React (JS, not TS)
- **Backend**: Node + Express
- **LLM**: Groq directly (HTTP `fetch` to `https://api.groq.com/openai/v1/chat/completions`, no SDK)
- **Security**: API key stays server-side (`backend/.env`)
- **Guardrails + rate limiting**: enforced on the **server** (the client mirrors them only for UX)

> Arlo is not a therapist. If you are in crisis: US — call/text **988**; UK & ROI — Samaritans **116 123**; international — https://findahelpline.com.

### Project layout

- `frontend/` — Vite React app
- `backend/` — Express API server
  - `systemPrompt.js` — wellness companion prompt (server-owned)
  - `guardrails.js` — input/output regex guardrails + crisis response
  - `rateLimit.js` — in-memory sliding-window limiter
- `AI_TOOLS.md` — tools used, tradeoffs, caveats, future improvements

### Setup

1) Backend env:

```
cp backend/.env.example backend/.env
# set GROQ_API_KEY=...
```

2) Install:

```bash
cd backend && npm install
cd ../frontend && npm install
```

### Run

```bash
# terminal 1
cd backend && npm run dev

# terminal 2
cd frontend && npm run dev
```

Open the Vite URL (usually `http://localhost:5173`).

### API

- `POST /api/chat`
  - body: `{ messages: [{ role: "user"|"assistant", content: string }], maxTokens?: number }`
  - response: `{ text: string, flags?: { type: "crisis" | "guardrail" } }`
  - rate-limited (429 with `Retry-After` header on miss)
  - the system prompt and model are fixed server-side; clients cannot override
- `GET /api/limits` — returns the current per-IP limits
- `GET /health`
