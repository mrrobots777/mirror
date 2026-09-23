const { ENV } = require("../core/nomes");
const Redis = require("ioredis");

const REDIS_URL = ENV.REDIS_URL || "";
let redis = null;

if (REDIS_URL) {
  try {
    redis = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        if (times > 3) return null;
        return Math.min(times * 200, 2000);
      },
      lazyConnect: true,
      enableReadyCheck: true,
      connectTimeout: 5000,
    });
    redis.on("error", (e) => {
      if (!redis._warned) { console.error(`[redis] ${e.message}`); redis._warned = true; }
    });
    redis.on("connect", () => { redis._warned = false; console.log("[redis] connected"); });
    redis.connect().catch(() => {});
  } catch (e) {
    console.error(`[redis] init failed: ${e.message}`);
    redis = null;
  }
} else {
  console.log("[redis] no REDIS_URL, using in-memory cache (single process only)");
}

function isAvailable() { return redis && redis.status === "ready"; }

async function cacheGet(prefix, key) {
  if (!isAvailable()) return null;
  try {
    const raw = await redis.get(`${prefix}:${key}`);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (_) { return null; }
}

async function cacheSet(prefix, key, value, ttlSeconds) {
  if (!isAvailable()) return;
  try {
    await redis.set(`${prefix}:${key}`, JSON.stringify(value), "EX", ttlSeconds);
  } catch (_) {}
}

const RATE_LIMIT_SCRIPT = `
local current = redis.call('incr', KEYS[1])
if current == 1 then
  redis.call('expire', KEYS[1], ARGV[1])
end
local ttl = redis.call('ttl', KEYS[1])
return {current, ttl}
`;

async function incrRateLimit(key, windowSeconds, maxRequests) {
  if (!isAvailable()) return { allowed: true, remaining: maxRequests };
  try {
    const k = `rl:${key}`;
    const result = await redis.eval(RATE_LIMIT_SCRIPT, 1, k, windowSeconds);
    const current = result[0];
    const ttl = result[1];
    return {
      allowed: current <= maxRequests,
      remaining: Math.max(0, maxRequests - current),
      resetAt: ttl > 0 ? Date.now() + ttl * 1000 : Date.now() + windowSeconds * 1000,
    };
  } catch (_) { return { allowed: true, remaining: maxRequests }; }
}

async function getStats() {
  if (!isAvailable()) return { redis: false };
  try {
    const info = await redis.info("stats");
    const memory = await redis.info("memory");
    return {
      redis: true,
      connected_clients: (info.match(/connected_clients:(\d+)/) || [])[1] || "?",
      used_memory: (memory.match(/used_memory_human:([^\r\n]+)/) || [])[1] || "?",
    };
  } catch (_) { return { redis: false }; }
}

module.exports = {
  isAvailable, cacheGet, cacheSet,
  incrRateLimit, getStats,
};
