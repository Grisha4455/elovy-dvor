import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import type { AssistantService } from "../assistant/assistant.js";
import { AppError } from "../errors.js";
import type { BookingService } from "../services/bookingService.js";

const id = z.coerce.number().int().positive();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Формат даты ГГГГ-ММ-ДД");

const stay = z.object({
  cabinId: z.number().int().positive(),
  checkIn: isoDate,
  checkOut: isoDate,
  guests: z.number().int().min(1).max(30),
});

const bookingSchema = stay.extend({
  guestName: z.string().trim().min(2).max(80),
  phone: z.string().max(30),
  comment: z.string().max(500).optional(),
  // Скрытое поле-ловушка: люди его не видят, боты заполняют
  website: z.string().max(200).optional(),
});

const chatSchema = z.object({
  sessionId: z.uuid().optional(),
  message: z.string().trim().min(1).max(1000),
});

const limiter = (windowMinutes: number, limit: number, message: string) =>
  rateLimit({
    windowMs: windowMinutes * 60_000,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "rate_limited", message },
  });

export function publicRouter(bookings: BookingService, assistant: AssistantService | null): Router {
  const router = Router();

  router.get("/cabins", (_req, res) => {
    res.json({ cabins: bookings.listCabins() });
  });

  router.get("/cabins/:id/availability", (req, res) => {
    const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).parse(req.query.month);
    res.json({ busy: bookings.busyNights(id.parse(req.params.id), month) });
  });

  router.get("/availability", (req, res) => {
    const q = z
      .object({ checkIn: isoDate, checkOut: isoDate, guests: z.coerce.number().int().min(1).max(30) })
      .parse(req.query);
    const free = bookings.findAvailable(q.checkIn, q.checkOut, q.guests);
    res.json({ available: free.map(({ cabin, quote }) => ({ cabinId: cabin.id, total: quote.total })) });
  });

  router.post("/quote", (req, res) => {
    const s = stay.parse(req.body);
    const { cabin, ...quote } = bookings.quote(s.cabinId, s.checkIn, s.checkOut, s.guests);
    res.json({ ...quote, available: bookings.isAvailable(cabin.id, s.checkIn, s.checkOut) });
  });

  router.post("/bookings", limiter(60, 5, "Слишком много заявок. Позвоните нам, пожалуйста."), (req, res) => {
    const body = bookingSchema.parse(req.body);
    if (body.website) {
      // Боту отвечаем как будто всё хорошо, но ничего не создаём
      res.status(201).json({ code: "ED-000000", status: "pending" });
      return;
    }
    const booking = bookings.create(body, "site", "guest");
    // Наружу отдаём только код и сумму, без персональных данных
    res.status(201).json({ code: booking.code, status: booking.status, total: booking.total });
  });

  router.post("/assistant", limiter(10, 30, "Слишком много сообщений, сделайте паузу."), async (req, res) => {
    if (!assistant) throw new AppError(503, "assistant_disabled", "AI-администратор не настроен на этом сервере");
    const { sessionId, message } = chatSchema.parse(req.body);
    res.json(await assistant.chat(sessionId, message));
  });

  return router;
}
