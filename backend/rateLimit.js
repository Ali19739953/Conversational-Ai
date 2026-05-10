// Per-key sliding window with a global ceiling.
// Keys are derived only from req.ip (Express resolves this from
// X-Forwarded-For when `app.set('trust proxy', N)` is configured). We do NOT
// fall back to the raw header, because the client controls it — that bypass
// would let an attacker rotate XFF per request and defeat the limiter.
//
// IPv6 keys are normalized to /64, since residential ISPs hand a full /64 to
// each customer; treating each address as a unique caller would let one user
// trivially evade the limit.

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 20;
const DAILY_MS = 24 * 60 * 60 * 1000;
const MAX_PER_DAY = 200;

const GLOBAL_WINDOW_MS = 60_000;
const GLOBAL_MAX_PER_WINDOW = 240;

const buckets = new Map();
const globalWindow = [];

function getBucket(key) {
  let b = buckets.get(key);
  if (!b) {
    b = { window: [], day: [] };
    buckets.set(key, b);
  }
  return b;
}

function prune(arr, ttl, now) {
  while (arr.length && now - arr[0] > ttl) arr.shift();
}

function ipKey(req) {
  const ip = req.ip;
  if (!ip || typeof ip !== "string") return "unknown";
  // IPv6: keep first four groups (/64). Handles "::ffff:1.2.3.4" by returning
  // the embedded IPv4 untouched.
  if (ip.includes(":") && !ip.startsWith("::ffff:")) {
    const groups = ip.split(":");
    return groups.slice(0, 4).join(":") + "::/64";
  }
  return ip.replace(/^::ffff:/, "");
}

export function checkRateLimit(key) {
  const now = Date.now();

  prune(globalWindow, GLOBAL_WINDOW_MS, now);
  if (globalWindow.length >= GLOBAL_MAX_PER_WINDOW) {
    const retryAfter = Math.ceil((GLOBAL_WINDOW_MS - (now - globalWindow[0])) / 1000);
    return { ok: false, scope: "global", retryAfter };
  }

  const b = getBucket(key);
  prune(b.window, WINDOW_MS, now);
  prune(b.day, DAILY_MS, now);

  if (b.window.length >= MAX_PER_WINDOW) {
    const retryAfter = Math.ceil((WINDOW_MS - (now - b.window[0])) / 1000);
    return { ok: false, scope: "minute", retryAfter };
  }
  if (b.day.length >= MAX_PER_DAY) {
    const retryAfter = Math.ceil((DAILY_MS - (now - b.day[0])) / 1000);
    return { ok: false, scope: "day", retryAfter };
  }

  b.window.push(now);
  b.day.push(now);
  globalWindow.push(now);
  return {
    ok: true,
    remainingMinute: MAX_PER_WINDOW - b.window.length,
    remainingDay: MAX_PER_DAY - b.day.length,
  };
}

export function rateLimitMiddleware(req, res, next) {
  const key = ipKey(req);
  const result = checkRateLimit(key);

  if (!result.ok) {
    res.setHeader("Retry-After", String(result.retryAfter));
    const message =
      result.scope === "day"
        ? "Daily limit reached. Please come back tomorrow."
        : result.scope === "global"
          ? "Service is busy right now. Please try again in a minute."
          : `You're sending messages too quickly. Try again in ~${result.retryAfter}s.`;
    return res.status(429).json({
      error: message,
      retryAfter: result.retryAfter,
      scope: result.scope,
    });
  }

  res.setHeader("X-RateLimit-Remaining-Minute", String(result.remainingMinute));
  res.setHeader("X-RateLimit-Remaining-Day", String(result.remainingDay));
  next();
}

setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) {
    prune(b.window, WINDOW_MS, now);
    prune(b.day, DAILY_MS, now);
    if (!b.window.length && !b.day.length) buckets.delete(k);
  }
  prune(globalWindow, GLOBAL_WINDOW_MS, now);
}, 5 * 60_000).unref?.();

export const RATE_CONFIG = {
  WINDOW_MS,
  MAX_PER_WINDOW,
  DAILY_MS,
  MAX_PER_DAY,
  GLOBAL_WINDOW_MS,
  GLOBAL_MAX_PER_WINDOW,
};
