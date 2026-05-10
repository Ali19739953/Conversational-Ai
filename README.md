## Arlo — Mental-Wellness Companion (Vite + React + Node + Groq)

A small full-stack chat prototype: a non-clinical mental-wellness companion with **server-enforced rate limiting and guardrails**.

- **Frontend**: Vite + React (JS, not TS)
- **Backend**: Node + Express
- **LLM**: Groq directly (HTTP `fetch` to `https://api.groq.com/openai/v1/chat/completions`, no SDK)
- **Security**: API key stays server-side (`backend/.env`)
- **Guardrails + rate limiting**: enforced on the **server** (the client mirrors them only for UX)

### Project layout

- `frontend/` — Vite React app
- `backend/` — Express API server
  - `systemPrompt.js` — wellness companion prompt (server-owned)
  - `guardrails.js` — input/output regex guardrails + crisis response
  - `rateLimit.js` — in-memory sliding-window limiter
- `AI_TOOLS.md` — tools used, tradeoffs, caveats, future improvements

### Setup

1) **Get a Groq API key** (free tier, no credit card):

   1. Sign in at https://console.groq.com
   2. Open **API Keys** → **Create API Key**: https://console.groq.com/keys
   3. Copy the `gsk_…` key — you will not see it again.

   Docs: https://console.groq.com/docs/quickstart

2) **Set your key in the backend env file:**

   ```bash
   cp backend/.env.example backend/.env
   # then edit backend/.env and set:
   #   GROQ_API_KEY=gsk_your_key_here
   ```

   Notes:
   - `backend/.env` is git-ignored — never commit your key.
   - If you accidentally leak a key, **rotate it immediately** in the Groq console (the dashboard supports revoke + re-issue).
   - The backend will refuse to start if `GROQ_API_KEY` is missing.

3) **Install dependencies:**

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
