import "dotenv/config";
import { z } from "zod";

const schema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    HOST: z.string().default("0.0.0.0"),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    CORS_ORIGIN: z.string().url().default("http://localhost:5173"),
    DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
    SESSION_SECRET: z
      .string()
      .min(32)
      .default("local-only-trusttask-session-secret-change-before-deployment"),
  })
  .superRefine((value, context) => {
    if (
      value.NODE_ENV === "production" &&
      value.SESSION_SECRET ===
        "local-only-trusttask-session-secret-change-before-deployment"
    ) {
      context.addIssue({
        code: "custom",
        path: ["SESSION_SECRET"],
        message: "SESSION_SECRET must be set in production",
      });
    }
  });

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  return schema.parse(env);
}
