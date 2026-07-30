import assert from "node:assert/strict";
import test from "node:test";
import { FixedWindowRateLimiter, getRequestLimitPolicy } from "../src/server/rate-limit";

test("limita requisicoes dentro da mesma janela", () => {
  let now = 1_000;
  const limiter = new FixedWindowRateLimiter({ maxRequests: 2, windowMs: 10_000 }, () => now);

  assert.equal(limiter.consume("ip-a").allowed, true);
  assert.equal(limiter.consume("ip-a").allowed, true);
  const blocked = limiter.consume("ip-a");
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.remaining, 0);
  assert.equal(blocked.retryAfterSeconds, 10);

  now += 10_000;
  assert.equal(limiter.consume("ip-a").allowed, true);
});

test("mantem contadores separados por origem", () => {
  const limiter = new FixedWindowRateLimiter({ maxRequests: 1, windowMs: 10_000 });
  assert.equal(limiter.consume("ip-a").allowed, true);
  assert.equal(limiter.consume("ip-a").allowed, false);
  assert.equal(limiter.consume("ip-b").allowed, true);
});

test("carrega limites do ambiente e rejeita valores invalidos", () => {
  const policy = getRequestLimitPolicy({
    API_RATE_LIMIT: "100",
    AUTH_RATE_LIMIT: "4",
    HEAVY_RATE_LIMIT: "12",
  });
  assert.equal(policy.general.maxRequests, 100);
  assert.equal(policy.auth.maxRequests, 4);
  assert.equal(policy.heavy.maxRequests, 12);
  assert.throws(() => getRequestLimitPolicy({ API_RATE_LIMIT: "0" }), /API_RATE_LIMIT/);
});
