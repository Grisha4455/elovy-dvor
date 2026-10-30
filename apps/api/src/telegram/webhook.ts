import { timingSafeEqual } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { AppError } from "../errors.js";
import type { BookingService } from "../services/bookingService.js";
import type { TelegramApi } from "./telegramApi.js";
import { formatBooking, statusLine } from "./telegramNotifier.js";

const updateSchema = z.object({
  callback_query: z
    .object({
      id: z.string(),
      data: z.string().optional(),
      from: z.object({ id: z.number(), username: z.string().optional() }),
      message: z.object({ message_id: z.number(), chat: z.object({ id: z.number() }) }).optional(),
    })
    .optional(),
  message: z
    .object({
      text: z.string().optional(),
      chat: z.object({ id: z.number() }),
    })
    .optional(),
});

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export interface WebhookDeps {
  bookings: BookingService;
  api: TelegramApi;
  chatId: string;
  secret: string;
  /** Текст сводки для команды /today — та же функция, что шлёт утренний дайджест */
  digest: () => string;
}

/**
 * Telegram присылает сюда нажатия кнопок «Подтвердить / Отклонить» и команды владельца.
 * Подлинность проверяем по заголовку X-Telegram-Bot-Api-Secret-Token (задаётся в setWebhook).
 */
export function telegramWebhook(deps: WebhookDeps): Router {
  const router = Router();

  router.post("/", async (req, res) => {
    const header = req.get("x-telegram-bot-api-secret-token") ?? "";
    if (!safeEqual(header, deps.secret)) {
      res.status(401).end();
      return;
    }
    const parsed = updateSchema.safeParse(req.body);
    // На любые непонятные апдейты отвечаем 200, иначе Telegram будет слать их повторно
    if (!parsed.success) {
      res.sendStatus(200);
      return;
    }
    const { callback_query: query, message } = parsed.data;

    if (query?.message && String(query.message.chat.id) === deps.chatId) {
      await handleCallback(deps, query.id, query.data ?? "", query.from, query.message);
    } else if (message?.text && String(message.chat.id) === deps.chatId) {
      await handleCommand(deps, message.text.trim());
    }
    res.sendStatus(200);
  });

  return router;
}

async function handleCallback(
  deps: WebhookDeps,
  queryId: string,
  data: string,
  from: { id: number; username?: string },
  message: { message_id: number; chat: { id: number } },
) {
  const match = /^(confirm|decline):(\d+)$/.exec(data);
  if (!match) return;
  const action = match[1] as "confirm" | "decline";
  const actor = `telegram:${from.username ?? from.id}`;
  try {
    const booking = deps.bookings.applyAction(Number(match[2]), action, actor);
    await deps.api.editMessageText(message.chat.id, message.message_id, `${statusLine(booking)}\n\n${formatBooking(booking)}`);
    await deps.api.answerCallbackQuery(queryId, action === "confirm" ? "Бронь подтверждена" : "Заявка отклонена");
  } catch (err) {
    const text = err instanceof AppError ? err.message : "Не удалось обработать";
    if (!(err instanceof AppError)) console.error("telegram callback failed", err);
    await deps.api.answerCallbackQuery(queryId, text).catch(() => undefined);
  }
}

async function handleCommand(deps: WebhookDeps, text: string) {
  const command = text.split(/[\s@]/)[0];
  if (command === "/today") {
    await deps.api.sendMessage(deps.chatId, deps.digest());
  } else if (command === "/pending") {
    const pending = deps.bookings.listBookings({ status: "pending" });
    const html = pending.length
      ? `<b>Ждут ответа: ${pending.length}</b>\n\n${pending.slice(0, 10).map(formatBooking).join("\n\n")}`
      : "Неподтверждённых заявок нет 👌";
    await deps.api.sendMessage(deps.chatId, html);
  }
}
