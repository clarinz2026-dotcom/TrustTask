import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  hashPassword,
  verifyPassword,
  createSessionToken,
} from "../auth/session.js";
import { getPool } from "../db/pool.js";
import { withTransaction } from "../db/transaction.js";
import { AppError, badRequest, unauthorized } from "./errors.js";

const registerSchema = z
  .object({
    email: z
      .email()
      .max(254)
      .transform((value) => value.toLowerCase()),
    displayName: z.string().trim().min(2).max(80),
    password: z.string().min(12).max(128),
    role: z.enum(["contributor", "client"]),
  })
  .strict();
const loginSchema = z
  .object({
    email: z.email().transform((value) => value.toLowerCase()),
    password: z.string().min(1).max(128),
  })
  .strict();

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/auth/register",
    { config: { rateLimit: { max: 10, timeWindow: "15 minutes" } } },
    async (request, reply) => {
      const input = registerSchema.safeParse(request.body);
      if (!input.success) throw badRequest("Registration fields are invalid");
      const passwordHash = await hashPassword(input.data.password);
      try {
        const user = await withTransaction(async (client) => {
          const inserted = await client.query<{
            id: string;
            email: string;
            role: string;
          }>(
            "INSERT INTO users (email, display_name, role, password_hash) VALUES ($1, $2, $3, $4) RETURNING id, email, role",
            [
              input.data.email,
              input.data.displayName,
              input.data.role,
              passwordHash,
            ],
          );
          const row = inserted.rows[0]!;
          await client.query(
            "INSERT INTO audit_events (actor_id, event_type, target_type, target_id, request_id) VALUES ($1, 'identity.registered', 'user', $1, $2)",
            [row.id, request.id],
          );
          return row;
        });
        return reply.code(201).send({
          token: createSessionToken(user.id),
          user: { id: user.id, email: user.email, role: user.role },
        });
      } catch (error) {
        if (isUniqueViolation(error))
          throw new AppError(
            409,
            "EMAIL_IN_USE",
            "An account with this email already exists",
          );
        throw error;
      }
    },
  );

  app.post(
    "/auth/login",
    { config: { rateLimit: { max: 10, timeWindow: "15 minutes" } } },
    async (request, reply) => {
      const input = loginSchema.safeParse(request.body);
      if (!input.success) throw badRequest("Login fields are invalid");
      const result = await getPool().query<{
        id: string;
        email: string;
        role: string;
        password_hash: string;
      }>("SELECT id, email, role, password_hash FROM users WHERE email = $1", [
        input.data.email,
      ]);
      const user = result.rows[0];
      if (
        !user ||
        !(await verifyPassword(input.data.password, user.password_hash))
      )
        throw unauthorized();
      return reply.send({
        token: createSessionToken(user.id),
        user: { id: user.id, email: user.email, role: user.role },
      });
    },
  );
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  );
}
