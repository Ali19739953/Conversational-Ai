// ─── CONFIG ───────────────────────────────────────────────────────
const MODEL         = 'claude-sonnet-4-20250514';
const MAX_TOKENS    = 800;
const MAX_HISTORY   = 12;          // sliding context window
const RATE_LIMIT    = 8;           // messages per window
const RATE_WINDOW   = 60 * 1000;   // 1 minute in ms
const MAX_INPUT_LEN = 1500;

const SYSTEM_PROMPT = `You are Arlo, a helpful and knowledgeable AI assistant. \
Be concise, precise, and genuinely useful. Avoid filler phrases, unnecessary hedging, \
and verbose intros. Get to the point. When asked technical questions, give specific, \
actionable answers.`;

// ─── GUARDRAILS ───────────────────────────────────────────────────
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

// ─── RATE LIMITER ─────────────────────────────────────────────────
const timestamps = [];

function canSend() {
  const now = Date.now();
  // Remove timestamps older than window
  while (timestamps.length && now - timestamps[0] > RATE_WINDOW) timestamps.shift();
  return timestamps.length < RATE_LIMIT;
}

function recordSend() {
  timestamps.push(Date.now());
  updateRateUI();
}

function remaining() {
  const now = Date.now();
  while (timestamps.length && now - timestamps[0] > RATE_WINDOW) timestamps.shift();
  return RATE_LIMIT - timestamps.length;
}

function updateRateUI() {
  const r = remaining();
  const used = RATE_LIMIT - r;
  const pct = (used / RATE_LIMIT) * 100;

  const fill = document.getElementById('rate-fill');
  const label = document.getElementById('rate-label');
  const rateLimitMsg = document.getElementById('rate-limit-msg');

  fill.style.width = pct + '%';
  fill.className = 'rate-bar-fill' + (pct >= 100 ? ' full' : pct >= 62 ? ' warn' : '');

  label.textContent = `${r} / ${RATE_LIMIT} left`;
  label.className = 'rate-indicator' + (r <= 2 ? ' warn' : '');

  if (!canSend()) {
    // Figure out when the oldest timestamp expires
    const wait = Math.ceil((RATE_WINDOW - (Date.now() - timestamps[0])) / 1000);
    rateLimitMsg.textContent = `Slow down — rate limit reached. Resets in ~${wait}s.`;
    rateLimitMsg.classList.add('show');
    document.getElementById('send-btn').disabled = true;

    // Auto-clear when window rolls over
    setTimeout(() => {
      rateLimitMsg.classList.remove('show');
      document.getElementById('send-btn').disabled = false;
      updateRateUI();
    }, wait * 1000 + 100);
  } else {
    rateLimitMsg.classList.remove('show');
  }
}

// ─── STATE ────────────────────────────────────────────────────────
let history = [];
let loading = false;

// ─── DOM HELPERS ──────────────────────────────────────────────────
const chatInner = document.getElementById('chat-inner');
const chatScroll = document.getElementById('chat-scroll');
const input = document.getElementById('msg-input');
const sendBtn = document.getElementById('send-btn');

function scrollBottom() {
  chatScroll.scrollTop = chatScroll.scrollHeight;
}

function removeEmpty() {
  const e = document.getElementById('empty');
  if (e) e.remove();
}

function addGroup(role) {
  const g = document.createElement('div');
  g.className = `msg-group ${role}`;

  const label = document.createElement('div');
  label.className = 'msg-label';
  label.textContent = role === 'user' ? 'you' : 'arlo';
  g.appendChild(label);

  chatInner.appendChild(g);
  return g;
}

function addBubble(group, text, type = '') {
  const b = document.createElement('div');
  b.className = 'bubble' + (type ? ` ${type}` : '');
  b.textContent = text;
  group.appendChild(b);
  scrollBottom();
  return b;
}

function addThinking() {
  const g = addGroup('ai');
  g.id = 'thinking-group';
  const b = document.createElement('div');
  b.className = 'bubble ai thinking';
  b.innerHTML = '<span></span><span></span><span></span>';
  g.appendChild(b);
  scrollBottom();
  return g;
}

// ─── CORE SEND ────────────────────────────────────────────────────
async function send() {
  const text = input.value.trim();

  if (!text || loading) return;

  // ── Guardrails ──
  const guard = checkGuardrails(text);

  if (guard.blocked) {
    removeEmpty();

    const g = addGroup('ai');
    addBubble(g, `⚠ ${guard.reason}`, 'guardrail');

    input.value = '';
    updateCharCount();
    return;
  }

  // ── Rate Limit ──
  if (!canSend()) {
    updateRateUI();
    return;
  }

  loading = true;
  sendBtn.disabled = true;

  input.value = '';
  input.style.height = 'auto';

  updateCharCount();
  removeEmpty();

  // ── User Bubble ──
  const userGroup = addGroup('user');
  addBubble(userGroup, text);

  // ── Save Message ──
  const userMessage = {
    role: 'user',
    content: text
  };

  history.push(userMessage);

  // sliding context
  const context = history.slice(-MAX_HISTORY);

  // rate limit
  recordSend();

  // thinking UI
  const thinkingGroup = addThinking();

  try {

    // OpenAI-compatible format
    const messages = [
      {
        role: 'system',
        content: SYSTEM_PROMPT
      },
      ...context
    ];

    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`,
        'HTTP-Referer': window.location.origin,
        'X-Title': 'Arlo'
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        max_tokens: MAX_TOKENS,
        temperature: 0.7
      })
    });

    thinkingGroup.remove();

    if (!res.ok) {

      let errMsg = `HTTP ${res.status}`;

      try {
        const err = await res.json();
        errMsg = err?.error?.message || errMsg;
      } catch {}

      throw new Error(errMsg);
    }

    const data = await res.json();

    const reply =
      data?.choices?.[0]?.message?.content;

    if (!reply) {
      throw new Error('Empty response');
    }

    // save assistant response
    history.push({
      role: 'assistant',
      content: reply
    });

    // render
    const aiGroup = addGroup('ai');

    addBubble(aiGroup, reply);

  } catch (err) {

    thinkingGroup.remove();

    // remove failed user message
    history = history.filter(m => m !== userMessage);

    const errGroup = addGroup('ai');

    const msg =
      err.message.includes('fetch')
        ? getFallback()
        : `Error: ${err.message}`;

    addBubble(errGroup, msg, 'error');

  } finally {

    loading = false;

    if (canSend()) {
      sendBtn.disabled = false;
    }

    updateRateUI();

    input.focus();

    scrollBottom();
  }
}

function useSuggestion(text) {
  input.value = text;
  updateCharCount();
  send();
}

// ─── INPUT BEHAVIOUR ──────────────────────────────────────────────
function updateCharCount() {
  const len = input.value.length;
  document.getElementById('char-count').textContent = `${len} / ${MAX_INPUT_LEN}`;
}

input.addEventListener('input', () => {
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 130) + 'px';
  updateCharCount();
});

input.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    send();
  }
});

// Init
updateRateUI();
updateCharCount();
