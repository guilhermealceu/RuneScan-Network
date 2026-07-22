import { randomBytes, timingSafeEqual } from "node:crypto";

const MIN_TOKEN_LENGTH = 24;
const SESSION_COOKIE = "runescan_session";
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

export interface AccessPolicy {
  host: "127.0.0.1" | "0.0.0.0";
  lanEnabled: boolean;
  authRequired: boolean;
  apiToken?: string;
}

export function getAccessPolicy(env: NodeJS.ProcessEnv = process.env): AccessPolicy {
  const lanEnabled = String(env.ALLOW_LAN_ACCESS || "false").toLowerCase() === "true";
  const apiToken = env.API_TOKEN?.trim();

  if (lanEnabled && (!apiToken || apiToken.length < MIN_TOKEN_LENGTH)) {
    throw new Error(
      `ALLOW_LAN_ACCESS=true exige API_TOKEN com pelo menos ${MIN_TOKEN_LENGTH} caracteres.`,
    );
  }

  return {
    host: lanEnabled ? "0.0.0.0" : "127.0.0.1",
    lanEnabled,
    authRequired: lanEnabled,
    apiToken,
  };
}

export class AccessController {
  private readonly sessions = new Map<string, number>();

  constructor(
    private readonly policy: AccessPolicy,
    private readonly now: () => number = Date.now,
  ) {}

  createSession(candidate: unknown): string | null {
    if (!this.policy.authRequired) return "local-access";
    if (typeof candidate !== "string" || !this.policy.apiToken) return null;

    const expected = Buffer.from(this.policy.apiToken);
    const received = Buffer.from(candidate);
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;

    this.removeExpiredSessions();
    const sessionId = randomBytes(32).toString("base64url");
    this.sessions.set(sessionId, this.now() + SESSION_TTL_MS);
    return sessionId;
  }

  isAuthorized(cookieHeader?: string): boolean {
    if (!this.policy.authRequired) return true;
    const sessionId = parseCookie(cookieHeader, SESSION_COOKIE);
    if (!sessionId) return false;

    const expiresAt = this.sessions.get(sessionId);
    if (!expiresAt || expiresAt <= this.now()) {
      if (expiresAt) this.sessions.delete(sessionId);
      return false;
    }
    return true;
  }

  buildSessionCookie(sessionId: string): string {
    return `${SESSION_COOKIE}=${sessionId}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_MS / 1000}`;
  }

  private removeExpiredSessions() {
    const currentTime = this.now();
    for (const [sessionId, expiresAt] of this.sessions) {
      if (expiresAt <= currentTime) this.sessions.delete(sessionId);
    }
  }
}

function parseCookie(cookieHeader: string | undefined, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return undefined;
}
