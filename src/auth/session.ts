import {
  createHmac,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { loadConfig } from "../config.js";
import { getPool } from "../db/pool.js";
import { forbidden, unauthorized } from "../http/errors.js";

const scrypt = promisify(scryptCallback);
const tokenPayloadSchema = z.object({
  sub: z.string().uuid(),
  exp: z.number().int(),
});
export type Role = "contributor" | "client" | "reviewer" | "support" | "admin";
export type Actor = { id: string; email: string; role: Role };

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt$${salt}$${derived.toString("hex")}`;
}

export async function verifyPassword(
  password: string,
  encoded: string,
): Promise<boolean> {
  const [algorithm, salt, expectedHex] = encoded.split("$");
  if (
    algorithm !== "scrypt" ||
    !salt ||
    !expectedHex ||
    !/^[a-f0-9]{128}$/.test(expectedHex)
  )
    return false;
  const actual = (await scrypt(password, salt, 64)) as Buffer;
  const expected = Buffer.from(expectedHex, "hex");
  return timingSafeEqual(actual, expected);
}

export function createSessionToken(userId: string, now = Date.now()): string {
  const payload = Buffer.from(
    JSON.stringify({ sub: userId, exp: Math.floor(now / 1000) + 3600 }),
  ).toString("base64url");
  const signature = createHmac("sha256", loadConfig().SESSION_SECRET)
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
}

function sessionUserId(token: string, now = Date.now()): string {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) throw unauthorized();
  const expected = createHmac("sha256", loadConfig().SESSION_SECRET)
    .update(payload)
    .digest();
  let actual: Buffer;
  try {
    actual = Buffer.from(signature, "base64url");
  } catch {
    throw unauthorized();
  }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    throw unauthorized();
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    throw unauthorized();
  }
  const parsed = tokenPayloadSchema.safeParse(decoded);
  if (!parsed.success || parsed.data.exp <= Math.floor(now / 1000))
    throw unauthorized();
  return parsed.data.sub;
}

export async function actorFromRequest(
  request: FastifyRequest,
): Promise<Actor> {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) throw unauthorized();
  const userId = sessionUserId(header.slice(7));
  const result = await getPool().query<Actor>(
    "SELECT id, email, role FROM users WHERE id = $1",
    [userId],
  );
  const actor = result.rows[0];
  if (!actor) throw unauthorized();
  return actor;
}

export function requireRole(actor: Actor, ...allowed: Role[]): void {
  if (!allowed.includes(actor.role)) throw forbidden();
}
