import { useEffect, useMemo, useRef, useState } from "react";

const DEFAULT_SYSTEM_PROMPT =
  "You are Arlo, a helpful and knowledgeable AI assistant. " +
  "Be concise, precise, and genuinely useful. Avoid filler phrases, unnecessary hedging, " +
  "and verbose intros. Get to the point. When asked technical questions, give specific, " +
  "actionable answers.";

const BLOCKED_PATTERNS = [
  /ignore (all |your )?(previous |prior )?instructions/i,
  /you are now (a |an )?(different|new|unrestricted)/i,
  /jailbreak/i,
  /bypass (your )?(safety|guardrail|filter)/i,
  /pretend (you (are|have) no|there are no) (restrictions|rules|limits)/i,
  /act as (DAN|an AI with no restrictions)/i,
];

const FALLBACK_RESPONSES = [
  "I hit a snag there — could you try rephrasing that?",
  "Something went wrong on my end. Please try again.",
  "I couldn't process that request. Try again in a moment.",
];

const MAX_HISTORY = 12;
const RATE_LIMIT = 8;
const RATE_WINDOW_MS = 60 * 1000;
const MAX_INPUT_LEN = 1500;

function getFallback() {
  return FALLBACK_RESPONSES[Math.floor(Math.random() * FALLBACK_RESPONSES.length)];
}

function checkGuardrails(text) {
  if (!text || !text.trim()) return { blocked: false };
  if (text.trim().length < 2) return { blocked: true, reason: "Message is too short." };
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(text)) {
      return { blocked: true, reason: "That kind of request isn't something I can help with." };
    }
  }
  return { blocked: false };
}

function pruneTimestamps(timestamps) {
  const now = Date.now();
  while (timestamps.length && now - timestamps[0] > RATE_WINDOW_MS) timestamps.shift();
}

function prompts() {
  return [
    { label: "Multi-agent RAG", text: "How do multi-agent RAG systems work?" },
    { label: "LLM tradeoffs", text: "What are the tradeoffs between GPT-4, Claude, and Gemini?" },
    { label: "E-commerce AI", text: "Design an AI pipeline for e-commerce personalization" },
    { label: "QLoRA explained", text: "Explain QLoRA fine-tuning vs full fine-tuning" },
  ];
}

export default function App() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [timestamps, setTimestamps] = useState([]);
  const [rateBanner, setRateBanner] = useState("");

  const chatScrollRef = useRef(null);
  const textareaRef = useRef(null);

  const remaining = useMemo(() => {
    const copy = [...timestamps];
    pruneTimestamps(copy);
    return RATE_LIMIT - copy.length;
  }, [timestamps]);

  const usedPct = useMemo(() => {
    const used = RATE_LIMIT - remaining;
    return Math.max(0, Math.min(100, (used / RATE_LIMIT) * 100));
  }, [remaining]);

  useEffect(() => {
    const el = chatScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, loading]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 130) + "px";
  }, [input]);

  async function callBackend(context) {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "openai/gpt-oss-20b",
        system: DEFAULT_SYSTEM_PROMPT,
        maxTokens: 800,
        messages: context,
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
    if (!data?.text) throw new Error("Empty response");
    return data.text;
  }

  function canSend(nextTimestamps) {
    const copy = [...nextTimestamps];
    pruneTimestamps(copy);
    return copy.length < RATE_LIMIT;
  }

  function recordSend() {
    setTimestamps((prev) => {
      const next = [...prev, Date.now()];
      return next;
    });
  }

  function showRateLimitBanner() {
    const copy = [...timestamps];
    pruneTimestamps(copy);
    if (copy.length < RATE_LIMIT) return;
    const waitSeconds = Math.ceil((RATE_WINDOW_MS - (Date.now() - copy[0])) / 1000);
    setRateBanner(`Slow down — rate limit reached. Resets in ~${waitSeconds}s.`);
    window.setTimeout(() => setRateBanner(""), waitSeconds * 1000 + 150);
  }

  async function send(textOverride) {
    const text = (textOverride ?? input).trim();
    if (!text || loading) return;

    const guard = checkGuardrails(text);
    if (guard.blocked) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", type: "guardrail", content: `⚠ ${guard.reason}` },
      ]);
      setInput("");
      return;
    }

    const nextTimestamps = [...timestamps];
    pruneTimestamps(nextTimestamps);
    if (!canSend(nextTimestamps)) {
      showRateLimitBanner();
      return;
    }

    setLoading(true);
    setRateBanner("");
    setInput("");
    recordSend();

    setMessages((prev) => [...prev, { role: "user", content: text }]);

    try {
      const context = [...messages, { role: "user", content: text }]
        .filter((m) => m.role === "user" || m.role === "assistant")
        .slice(-MAX_HISTORY)
        .map((m) => ({ role: m.role, content: m.content }));

      const reply = await callBackend(context);
      setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
    } catch (err) {
      const msg =
        err instanceof Error && /fetch|network/i.test(err.message)
          ? getFallback()
          : `Error: ${err instanceof Error ? err.message : "Unknown error"}`;
      setMessages((prev) => [...prev, { role: "assistant", type: "error", content: msg }]);
    } finally {
      setLoading(false);
      textareaRef.current?.focus();
    }
  }

  const charCount = `${input.length} / ${MAX_INPUT_LEN}`;
  const rateLabel = `${remaining} / ${RATE_LIMIT} left`;
  const rateFillClass =
    "rate-bar-fill" + (usedPct >= 100 ? " full" : usedPct >= 62 ? " warn" : "");
  const rateIndicatorClass = "rate-indicator" + (remaining <= 2 ? " warn" : "");

  return (
    <>
      <header>
        <div className="logo">
          <div className="logo-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </div>
          <span className="logo-name">Arlo</span>
        </div>
        <div className="header-right">
          <span className={rateIndicatorClass} id="rate-label">
            {rateLabel}
          </span>
          <div className="badge" title="Model family">
            <div className="badge-dot" />
            groq
          </div>
        </div>
      </header>

      <div className="chat-scroll" id="chat-scroll" ref={chatScrollRef}>
        <div className="chat-inner" id="chat-inner">
          {messages.length === 0 ? (
            <div className="empty" id="empty">
              <div className="empty-icon">✦</div>
              <div className="empty-title">What's on your mind?</div>
              <div className="empty-sub">
                Arlo is an AI-native app with Groq integration, guardrails, and rate limiting built
                in.
              </div>
              <div className="prompts">
                {prompts().map((p) => (
                  <button
                    key={p.label}
                    className="prompt-chip"
                    type="button"
                    onClick={() => send(p.text)}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              {messages.map((m, idx) => (
                <div key={idx} className={`msg-group ${m.role}`}>
                  <div className="msg-label">{m.role === "user" ? "you" : "arlo"}</div>
                  <div className={"bubble" + (m.type ? ` ${m.type}` : "")}>{m.content}</div>
                </div>
              ))}
              {loading ? (
                <div className="msg-group ai" id="thinking-group">
                  <div className="msg-label">arlo</div>
                  <div className="bubble ai thinking" aria-label="Thinking">
                    <span />
                    <span />
                    <span />
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>

      <div className="input-wrap">
        <div className="input-inner">
          <div className={"rate-limit-msg" + (rateBanner ? " show" : "")} id="rate-limit-msg">
            {rateBanner}
          </div>
          <div className="input-box">
            <textarea
              ref={textareaRef}
              id="msg-input"
              placeholder="Message Arlo..."
              rows={1}
              maxLength={MAX_INPUT_LEN}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
            />
            <button
              className="send-btn"
              id="send-btn"
              onClick={() => send()}
              disabled={loading || input.trim().length === 0 || remaining <= 0}
              title="Send"
              type="button"
            >
              <svg viewBox="0 0 24 24">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          </div>
          <div className="input-footer">
            <span className="input-meta" id="char-count">
              {charCount}
            </span>
            <div className="rate-bar-wrap">
              <span className="input-meta">rate limit</span>
              <div className="rate-bar">
                <div className={rateFillClass} id="rate-fill" style={{ width: `${usedPct}%` }} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
