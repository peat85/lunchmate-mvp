import { scryptSync, randomBytes, timingSafeEqual, createHmac } from "node:crypto";

const SESSION_DAYS = 30;

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split(":");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "hex");
  const actual = scryptSync(password, salt, expected.length);
  return timingSafeEqual(expected, actual);
}

/**
 * Stateless signed session token: "<userId>.<expiresAtMs>.<hmac>".
 * Stateless so it keeps working across serverless instances.
 */
export function createSessionToken(userId: number, secret: string, now = Date.now()): string {
  const payload = `${userId}.${now + SESSION_DAYS * 86_400_000}`;
  return `${payload}.${sign(payload, secret)}`;
}

export function readSessionToken(token: string | undefined, secret: string, now = Date.now()): number | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [id, exp, sig] = parts as [string, string, string];
  const expected = sign(`${id}.${exp}`, secret);
  if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  if (Number(exp) < now) return null;
  const userId = Number(id);
  return Number.isInteger(userId) && userId > 0 ? userId : null;
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export const SESSION_MAX_AGE_SECONDS = SESSION_DAYS * 86_400;
