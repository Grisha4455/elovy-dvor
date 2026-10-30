import cookieParser from "cookie-parser";
import express, { type ErrorRequestHandler, type RequestHandler } from "express";
import helmet from "helmet";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { ZodError } from "zod";
import type { AssistantService } from "./assistant/assistant.js";
import type { Config } from "./config.js";
import type { DB } from "./db.js";
import { AppError } from "./errors.js";
import { adminRouter } from "./http/adminRoutes.js";
import { authRouter, requireAuth } from "./http/auth.js";
import { publicRouter } from "./http/publicRoutes.js";
import type { BookingService } from "./services/bookingService.js";
import type { TelegramApi } from "./telegram/telegramApi.js";
import { telegramWebhook } from "./telegram/webhook.js";
import { buildDigest } from "./automation/jobs.js";

export interface AppDeps {
  config: Config;
  db: DB;
  bookings: BookingService;
  assistant: AssistantService | null;
  telegram: TelegramApi | null;
}

/**
 * Защита от CSRF для запросов, меняющих данные: cookie сессии уже SameSite=Strict,
 * дополнительно требуем, чтобы Origin (если браузер его прислал) совпадал с сайтом.
 */
function sameOrigin(allowed: string): RequestHandler {
  return (req, _res, next) => {
    if (req.method === "GET" || req.method === "HEAD") return next();
    const origin = req.get("origin");
    if (origin && origin !== allowed) return next(new AppError(403, "bad_origin", "Запрос с чужого сайта"));
    next();
  };
}

export function createApp({ config, db, bookings, assistant, telegram }: AppDeps) {
  const app = express();
  const production = config.NODE_ENV === "production";

  app.disable("x-powered-by");
  if (production) app.set("trust proxy", 1);
  app.use(
    helmet({
      // HTTPS обеспечивает обратный прокси; без этой директивы демо работает и на http://localhost
      contentSecurityPolicy: { directives: { "upgrade-insecure-requests": null } },
    }),
  );
  app.use(express.json({ limit: "50kb" }));
  app.use(cookieParser());

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, assistant: Boolean(assistant), telegram: Boolean(telegram) });
  });

  if (telegram && config.TELEGRAM_CHAT_ID && config.TELEGRAM_WEBHOOK_SECRET) {
    app.use(
      "/api/telegram/webhook",
      telegramWebhook({
        bookings,
        api: telegram,
        chatId: config.TELEGRAM_CHAT_ID,
        secret: config.TELEGRAM_WEBHOOK_SECRET,
        digest: () => buildDigest(db, bookings.today()),
      }),
    );
  }

  app.use("/api", sameOrigin(config.WEB_ORIGIN));
  app.use("/api/auth", authRouter(db, config.JWT_SECRET, production));
  app.use("/api/admin", requireAuth(db, config.JWT_SECRET), adminRouter(db, bookings));
  app.use("/api", publicRouter(bookings, assistant));
  app.use("/api", (_req, _res, next) => next(new AppError(404, "not_found", "Маршрут не найден")));

  // В продакшене тот же сервер отдаёт собранный фронтенд — один origin, без CORS
  const webDist = config.WEB_DIST ? resolve(config.WEB_DIST) : null;
  if (webDist && existsSync(webDist)) {
    app.use(express.static(webDist, { index: false, maxAge: "1h" }));
    app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(join(webDist, "index.html")));
  }

  app.use(errorHandler);
  return app;
}

const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: err.code, message: err.message });
    return;
  }
  if (err instanceof ZodError) {
    const message = err.issues.map((i) => `${i.path.join(".") || "запрос"}: ${i.message}`).join("; ");
    res.status(400).json({ error: "validation_error", message });
    return;
  }
  // Ошибки body-parser: битый JSON, слишком большое тело
  if (typeof err?.status === "number" && err.status < 500 && err.expose) {
    res.status(err.status).json({ error: "bad_request", message: "Некорректный запрос" });
    return;
  }
  console.error(err);
  res.status(500).json({ error: "internal_error", message: "Внутренняя ошибка сервера" });
};
