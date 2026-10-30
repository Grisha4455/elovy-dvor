import { Router } from "express";
import { z } from "zod";
import type { DB } from "../db.js";
import type { BookingService } from "../services/bookingService.js";
import { computeStats } from "../services/statsService.js";
import { requireRole } from "./auth.js";

const id = z.coerce.number().int().positive();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const filterSchema = z.object({
  status: z.enum(["pending", "confirmed", "declined", "cancelled", "expired"]).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});

const manualBooking = z.object({
  cabinId: z.number().int().positive(),
  checkIn: isoDate,
  checkOut: isoDate,
  guests: z.number().int().min(1).max(30),
  guestName: z.string().trim().min(2).max(80),
  phone: z.string().max(30),
  comment: z.string().max(500).optional(),
  confirm: z.boolean().default(true),
});

/** Все маршруты здесь уже за requireAuth (см. app.ts). */
export function adminRouter(db: DB, bookings: BookingService): Router {
  const router = Router();

  router.get("/bookings", (req, res) => {
    res.json({ bookings: bookings.listBookings(filterSchema.parse(req.query)) });
  });

  // Бронь по телефону: администратор вносит её сам и сразу подтверждает
  router.post("/bookings", (req, res) => {
    const { confirm, ...input } = manualBooking.parse(req.body);
    const actor = `admin:${req.user!.email}`;
    let booking = bookings.create(input, "admin", actor);
    if (confirm) booking = bookings.applyAction(booking.id, "confirm", actor);
    res.status(201).json({ booking });
  });

  for (const action of ["confirm", "decline"] as const) {
    router.post(`/bookings/:id/${action}`, (req, res) => {
      res.json({ booking: bookings.applyAction(id.parse(req.params.id), action, `admin:${req.user!.email}`) });
    });
  }

  // Отменить уже подтверждённую бронь может только владелец
  router.post("/bookings/:id/cancel", requireRole("owner"), (req, res) => {
    res.json({ booking: bookings.applyAction(id.parse(req.params.id), "cancel", `admin:${req.user!.email}`) });
  });

  router.get("/stats", requireRole("owner"), (_req, res) => {
    res.json(computeStats(db, bookings.today()));
  });

  router.get("/events", (req, res) => {
    const limit = z.coerce.number().int().min(1).max(200).default(50).parse(req.query.limit);
    const events = db
      .prepare(
        `SELECT e.id, e.type, e.actor, e.payload, e.created_at AS createdAt, b.code AS bookingCode
         FROM events e LEFT JOIN bookings b ON b.id = e.booking_id
         ORDER BY e.id DESC LIMIT ?`,
      )
      .all(limit) as { payload: string }[];
    res.json({ events: events.map((e) => ({ ...e, payload: JSON.parse(e.payload) })) });
  });

  return router;
}
