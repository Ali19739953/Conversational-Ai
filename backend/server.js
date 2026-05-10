import "dotenv/config";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { createGroqClient } from "./groqClient.js";

const PORT = Number.parseInt(process.env.PORT ?? "8787", 10);
const DEV_ORIGIN = process.env.DEV_ORIGIN ?? "http://localhost:5173";

const MODEL_ALLOWLIST = new Set(["openai/gpt-oss-20b"]);
const DEFAULT_MODEL = "openai/gpt-oss-20b";

const MAX_MESSAGES = 50;
const MAX_CONTENT_CHARS = 10_000;
const DEFAULT_MAX_TOKENS = 800;
const MAX_MAX_TOKENS = 4000;

function assertString(value, name) {
  if (typeof value !== "string") throw new Error(`Expected ${name} to be a string.`);
}

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function sanitizeMessages(messages) {
  if (!Array.isArray(messages)) throw new Error("messages must be an array.");
  if (messages.length === 0) throw new Error("messages must not be empty.");
  if (messages.length > MAX_MESSAGES) throw new Error(`messages too long (max ${MAX_MESSAGES}).`);

  return messages.map((m, i) => {
    if (!m || typeof m !== "object") throw new Error(`messages[${i}] must be an object.`);
    const { role, content } = m;
    if (role !== "user" && role !== "assistant") {
      throw new Error(`messages[${i}].role must be 'user' or 'assistant'.`);
    }
    assertString(content, `messages[${i}].content`);
    const trimmed = content.trim();
    if (!trimmed) throw new Error(`messages[${i}].content must not be empty.`);
    if (trimmed.length > MAX_CONTENT_CHARS) {
      throw new Error(`messages[${i}].content too large (max ${MAX_CONTENT_CHARS} chars).`);
    }
    return { role, content: trimmed };
  });
}

function buildTranscript({ system, messages }) {
  const parts = [];
  if (system) parts.push(`System:\n${system.trim()}\n`);
  for (const m of messages) {
    const speaker = m.role === "user" ? "User" : "Assistant";
    parts.push(`${speaker}:\n${m.content}\n`);
  }
  parts.push("Assistant:\n");
  return parts.join("\n");
}

const app = express();
app.disable("x-powered-by");
app.use(helmet());
app.use(express.json({ limit: "64kb" }));
app.use(
  cors({
    origin: DEV_ORIGIN,
    methods: ["POST"],
  }),
);

app.get("/health", (_req, res) => res.json({ ok: true }));

app.post("/api/chat", async (req, res, next) => {
  try {
    const { messages, system, model, maxTokens } = req.body ?? {};

    const safeMessages = sanitizeMessages(messages);

    let safeSystem;
    if (typeof system === "string" && system.trim()) {
      safeSystem = system.slice(0, 5000);
    }

    const pickedModel = typeof model === "string" ? model : DEFAULT_MODEL;
    if (!MODEL_ALLOWLIST.has(pickedModel)) {
      return res.status(400).json({ error: `Model not allowed: ${pickedModel}` });
    }

    const safeMaxTokens = clampInt(maxTokens, 1, MAX_MAX_TOKENS, DEFAULT_MAX_TOKENS);

    const client = createGroqClient();

    const input = buildTranscript({ system: safeSystem, messages: safeMessages });

    const response = await client.responses.create({
      model: pickedModel,
      input,
      max_output_tokens: safeMaxTokens,
    });

    const text = response?.output_text;
    if (!text || typeof text !== "string") {
      return res.status(502).json({ error: "Upstream returned an empty response." });
    }

    return res.json({ text });
  } catch (err) {
    return next(err);
  }
});

app.use((err, _req, res, _next) => {
  const message = err instanceof Error ? err.message : "Unknown error";
  const status = message.includes("must") || message.includes("Expected") || message.includes("too")
    ? 400
    : 500;
  res.status(status).json({ error: message });
});

app.listen(PORT, () => {
  console.log(`[backend] listening on http://localhost:${PORT}`);
  console.log(`[backend] dev origin allowed: ${DEV_ORIGIN}`);
});

