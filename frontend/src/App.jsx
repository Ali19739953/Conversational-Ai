import { useEffect, useRef, useState } from "react";

const PROMPTS = ["I'm anxious", "Can't sleep", "Grounding", "Hard day"];

const HOTLINES = [
  { label: "US & Canada — 988 Suicide & Crisis Lifeline", num: "988" },
  { label: "UK & Ireland — Samaritans", num: "116 123" },
  { label: "International directory", num: "findahelpline.com", href: "https://findahelpline.com" },
];

const MAX_CHARS = 2000;
const MAX_HISTORY = 12;
const RATE_LIMIT_PER_MIN = 10;
const RATE_WINDOW_MS = 60_000;

const CLIENT_BLOCKED_PATTERNS = [
  /ignore (all |your )?(previous |prior )?instructions/i,
  /you are now (a |an )?(different|new|unrestricted)/i,
  /\bjailbreak\b/i,
  /bypass (your )?(safety|guardrail|filter)/i,
  /pretend (you (are|have) no|there are no) (restrictions|rules|limits)/i,
  /act as (DAN|an AI with no restrictions)/i,
];

const FALLBACK_RESPONSES = [
  "I hit a snag there — could you try rephrasing that?",
  "Something went wrong on my end. Please try again.",
  "I couldn't process that request. Try again in a moment.",
];

function preflightGuard(text) {
  const t = (text ?? "").trim();
  if (!t) return { blocked: false };
  if (t.length < 2) return { blocked: true, reason: "Could you say a little more?" };
  for (const p of CLIENT_BLOCKED_PATTERNS) {
    if (p.test(t)) {
      return { blocked: true, reason: "I'm here as a wellness companion — what's on your mind today?" };
    }
  }
  return { blocked: false };
}

function pruneTimestamps(arr) {
  const now = Date.now();
  while (arr.length && now - arr[0] > RATE_WINDOW_MS) arr.shift();
}

export default function App() {
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [thinking, setThinking] = useState(false);
  const [timestamps, setTimestamps] = useState([]);
  const [rateWarn, setRateWarn] = useState("");

  const scrollRef = useRef(null);
  const taRef = useRef(null);

  const liveTimestamps = (() => {
    const copy = [...timestamps];
    pruneTimestamps(copy);
    return copy;
  })();
  const rateLeft = Math.max(0, RATE_LIMIT_PER_MIN - liveTimestamps.length);
  const ratePct = Math.round((rateLeft / RATE_LIMIT_PER_MIN) * 100);
  const rateLow = rateLeft <= Math.ceil(RATE_LIMIT_PER_MIN * 0.2);

  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 180) + "px";
  }, [draft]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, thinking]);

  function showRateBanner(seconds, custom) {
    setRateWarn(
      custom ?? `Slow down — please wait ~${seconds}s before sending again.`,
    );
    window.setTimeout(() => setRateWarn(""), seconds * 1000 + 150);
  }

  async function callBackend(context) {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: context }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 429) {
      const retry = data?.retryAfter ?? 30;
      const err = new Error(data?.error || `Rate limited. Try again in ${retry}s.`);
      err.code = "rate_limited";
      err.retryAfter = retry;
      throw err;
    }
    if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
    if (!data?.text) throw new Error("Empty response");
    return data;
  }

  async function send(textOverride) {
    const text = (textOverride ?? draft).trim();
    if (!text || thinking) return;

    const guard = preflightGuard(text);
    if (guard.blocked) {
      setMessages((m) => [
        ...m,
        { id: crypto.randomUUID(), role: "user", text },
        { id: crypto.randomUUID(), role: "ai", kind: "guardrail", text: guard.reason },
      ]);
      setDraft("");
      return;
    }

    const nextTs = [...timestamps];
    pruneTimestamps(nextTs);
    if (nextTs.length >= RATE_LIMIT_PER_MIN) {
      const wait = Math.ceil((RATE_WINDOW_MS - (Date.now() - nextTs[0])) / 1000);
      showRateBanner(wait);
      return;
    }

    const userMsg = { id: crypto.randomUUID(), role: "user", text };
    setMessages((m) => [...m, userMsg]);
    setDraft("");
    setRateWarn("");
    setTimestamps((prev) => [...prev, Date.now()]);
    setThinking(true);

    try {
      const ctxSource = [...messages, userMsg]
        .filter((m) => m.role === "user" || m.role === "ai")
        .slice(-MAX_HISTORY)
        .map((m) => ({ role: m.role === "ai" ? "assistant" : "user", content: m.text }));

      const reply = await callBackend(ctxSource);
      const kind = reply.flags?.type;
      setMessages((m) => [
        ...m,
        { id: crypto.randomUUID(), role: "ai", kind, text: reply.text },
      ]);
    } catch (err) {
      if (err.code === "rate_limited") {
        showRateBanner(err.retryAfter, err.message);
      } else {
        const text =
          err instanceof Error && /fetch|network/i.test(err.message)
            ? FALLBACK_RESPONSES[Math.floor(Math.random() * FALLBACK_RESPONSES.length)]
            : `Error: ${err instanceof Error ? err.message : "Unknown error"}`;
        setMessages((m) => [
          ...m,
          { id: crypto.randomUUID(), role: "ai", kind: "error", text },
        ]);
      }
    } finally {
      setThinking(false);
      taRef.current?.focus();
    }
  }

  function onKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  const canSend = draft.trim().length > 0 && !thinking && rateLeft > 0 && draft.length <= MAX_CHARS;
  const isEmpty = messages.length === 0 && !thinking;
  const charsLeft = MAX_CHARS - draft.length;

  return (
    <div className="app">
      <header className="header">
        <a className="logo" href="#" aria-label="Arlo home">
          <span className="logo-mark" aria-hidden="true" />
          <span className="logo-name">Arlo</span>
        </a>
        <div className="header-right">
          <span className="rate-indicator" title="Messages remaining in this window">
            {rateLeft} left
          </span>
          <span className="badge" aria-label="Wellness companion, not a therapist">
            <span className="badge-dot" aria-hidden="true" />
            Wellness companion
          </span>
        </div>
      </header>

      <main
        className="chat-scroll"
        ref={scrollRef}
        aria-live="polite"
        aria-relevant="additions text"
      >
        <div className="chat-inner">
          {isEmpty ? (
            <EmptyState onPick={(p) => send(p)} />
          ) : (
            messages.map((m) => <MessageGroup key={m.id} msg={m} />)
          )}

          {thinking && (
            <div className="msg-group ai" aria-label="Arlo is typing">
              <div className="msg-label">Arlo</div>
              <div className="bubble thinking" aria-hidden="true">
                <span /><span /><span />
              </div>
            </div>
          )}
        </div>
      </main>

      <footer className="input-wrap">
        {rateWarn && (
          <div className="rate-limit-msg" role="status">
            {rateWarn}
          </div>
        )}

        <div className="input-inner">
          <textarea
            ref={taRef}
            className="input-box"
            placeholder="Share what's on your mind…"
            value={draft}
            onChange={(e) => setDraft(e.target.value.slice(0, MAX_CHARS + 200))}
            onKeyDown={onKeyDown}
            rows={1}
            aria-label="Message Arlo"
          />
          <button
            type="button"
            className="send-btn"
            onClick={() => send()}
            disabled={!canSend}
            aria-label="Send message"
          >
            <SendIcon />
          </button>
        </div>

        <div className="input-footer">
          <span className={"input-meta" + (charsLeft < 100 ? " warn" : "")}>
            {draft.length}/{MAX_CHARS}
          </span>
          <div
            className="rate-bar"
            role="progressbar"
            aria-label="Message rate limit"
            aria-valuemin={0}
            aria-valuemax={RATE_LIMIT_PER_MIN}
            aria-valuenow={rateLeft}
          >
            <div
              className={"rate-bar-fill" + (rateLow ? " low" : "")}
              style={{ width: ratePct + "%" }}
            />
          </div>
          <span className="input-meta">Enter to send · Shift+Enter for newline</span>
        </div>
      </footer>
    </div>
  );
}

function EmptyState({ onPick }) {
  return (
    <section className="empty">
      <div className="empty-icon" aria-hidden="true">
        <LeafIcon />
      </div>
      <h1 className="empty-title">How are you feeling today?</h1>
      <p className="empty-sub">
        Arlo is a companion for everyday stress and reflection — not a therapist, and not a
        substitute for professional care. If you need support now, visit{" "}
        <a href="https://findahelpline.com" target="_blank" rel="noopener noreferrer">
          findahelpline.com
        </a>
        .
      </p>
      <div className="prompts" role="list">
        {PROMPTS.map((p) => (
          <button
            key={p}
            type="button"
            role="listitem"
            className="prompt-chip"
            onClick={() => onPick(p)}
          >
            {p}
          </button>
        ))}
      </div>
    </section>
  );
}

function MessageGroup({ msg }) {
  const isUser = msg.role === "user";
  const cls =
    "bubble " +
    (isUser ? "user" : "ai") +
    (msg.kind === "error" ? " error" : "") +
    (msg.kind === "guardrail" ? " guardrail" : "") +
    (msg.kind === "crisis" ? " guardrail" : "");

  return (
    <div className={"msg-group " + (isUser ? "user" : "ai")}>
      <div className="msg-label">{isUser ? "You" : "Arlo"}</div>
      <div className={cls}>{msg.text}</div>
      {msg.kind === "crisis" && <CrisisCard />}
    </div>
  );
}

function CrisisCard() {
  return (
    <aside className="crisis" aria-label="Crisis resources">
      <div className="crisis-head">If you're in crisis right now</div>
      <ul className="crisis-list">
        {HOTLINES.map((h) => (
          <li key={h.label} className="crisis-row">
            <span className="crisis-label">{h.label}</span>
            {h.href ? (
              <a className="crisis-num" href={h.href} target="_blank" rel="noopener noreferrer">
                {h.num} ↗
              </a>
            ) : (
              <a className="crisis-num" href={"tel:" + h.num.replace(/\s/g, "")}>
                {h.num}
              </a>
            )}
          </li>
        ))}
      </ul>
      <p className="crisis-foot">
        You don't have to explain or apologize. Reaching out is enough.
      </p>
    </aside>
  );
}

function SendIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M3 10L17 3L13 17L10 11L3 10Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

function LeafIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 21V12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path
        d="M12 12C12 8 14.5 5 19 4.5C19 9 16.5 12 12 12Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
        fill="currentColor"
        fillOpacity=".15"
      />
      <path
        d="M12 14C12 11 10 9 6.5 8.5C6.5 12 8.5 14 12 14Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
        fill="currentColor"
        fillOpacity=".15"
      />
    </svg>
  );
}
