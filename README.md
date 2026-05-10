## Arlo (Groq) — Vite + React + Node

Clean, review-friendly full-stack chat app:

- **Frontend**: Vite + React (**JavaScript**, not TypeScript)
- **Backend**: Node + Express
- **LLM**: Groq via OpenAI-compatible SDK (`openai`) using `baseURL: "https://api.groq.com/openai/v1"`
- **Security**: API key stays server-side (`backend/.env`)
- **Guardrails + Rate limiting**: implemented client-side (as in your original prototype)

### Project layout

- `frontend/`: Vite React app
- `backend/`: Express API server

### Setup

1) Create your backend env file:

- Copy `backend/.env.example` → `backend/.env`
- Set:
  - `GROQ_API_KEY=...`

2) Install dependencies:

```bash
cd backend
npm install

cd ../frontend
npm install
```

### Run (dev)

Backend:

```bash
cd backend
npm run dev
```

Frontend (Vite proxies `/api/*` to backend):

```bash
cd frontend
npm run dev
```

Open the Vite URL (usually `http://localhost:5173`).

### API

- `POST /api/chat`
  - Body:
    - `messages`: `[{ role: "user"|"assistant", content: string }]`
    - optional: `system`, `model`, `maxTokens`
  - Returns: `{ text }`

