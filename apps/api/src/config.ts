import { z } from "zod";

const optional = z.string().trim().min(1).optional();

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  DB_PATH: z.string().default("./data/elovy-dvor.db"),
  JWT_SECRET: z
    .string()
    .min(32, "JWT_SECRET должен быть не короче 32 символов (openssl rand -hex 32)"),
  WEB_ORIGIN: z.url().default("http://localhost:5173"),
  WEB_DIST: optional,

  ANTHROPIC_API_KEY: optional,
  ASSISTANT_MODEL: z.string().default("claude-opus-5-5"),

  TELEGRAM_BOT_TOKEN: optional,
  TELEGRAM_CHAT_ID: optional,
  TELEGRAM_WEBHOOK_SECRET: z.string().min(16).optional(),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // Пустые строки из .env считаем «не задано», иначе optional-поля не работают
  const cleaned = Object.fromEntries(
    Object.entries(env).filter(([, value]) => value !== undefined && value !== ""),
  );
  const result = schema.safeParse(cleaned);
  if (!result.success) {
    const details = result.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Неверная конфигурация:\n${details.join("\n")}`);
  }
  return result.data;
}
