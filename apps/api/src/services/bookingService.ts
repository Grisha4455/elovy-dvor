import { randomInt } from "node:crypto";
import type { DB } from "../db.js";
import { addDays, diffDays, eachNight, isIsoDate, minskToday } from "../domain/dates.js";
import { calculateQuote, type PriceQuote } from "../domain/pricing.js";
import { normalizeBelarusPhone } from "../domain/phone.js";
import {
  BLOCKING_STATUSES,
  TRANSITIONS,
  type Booking,
  type BookingAction,
  type BookingSource,
  type BookingStatus,
  type Cabin,
  type NewBooking,
} from "../domain/types.js";
import { AppError, badRequest, conflict, notFound } from "../errors.js";
import type { Notifier } from "./notifier.js";

export const MAX_NIGHTS = 30;
export const BOOKING_HORIZON_DAYS = 365;

interface CabinRow {
  id: number;
  slug: string;
  name: string;
  tagline: string;
  description: string;
  capacity: number;
  base_price: number;
  min_nights: number;
  amenities: string;
}

interface BookingRow {
  id: number;
  code: string;
  cabin_id: number;
  cabin_name: string;
  guest_name: string;
  phone: string;
  guests: number;
  check_in: string;
  check_out: string;
  total: number;
  status: BookingStatus;
  source: BookingSource;
  comment: string;
  created_at: string;
  updated_at: string;
}

const toCabin = (r: CabinRow): Cabin => ({
  id: r.id,
  slug: r.slug,
  name: r.name,
  tagline: r.tagline,
  description: r.description,
  capacity: r.capacity,
  basePrice: r.base_price,
  minNights: r.min_nights,
  amenities: JSON.parse(r.amenities) as string[],
});

const toBooking = (r: BookingRow): Booking => ({
  id: r.id,
  code: r.code,
  cabinId: r.cabin_id,
  cabinName: r.cabin_name,
  guestName: r.guest_name,
  phone: r.phone,
  guests: r.guests,
  checkIn: r.check_in,
  checkOut: r.check_out,
  total: r.total,
  status: r.status,
  source: r.source,
  comment: r.comment,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const BOOKING_SELECT = `
  SELECT b.*, c.name AS cabin_name FROM bookings b JOIN cabins c ON c.id = b.cabin_id`;

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function generateCode(): string {
  let code = "ED-";
  for (let i = 0; i < 6; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

export interface BookingFilter {
  status?: BookingStatus;
  from?: string;
  to?: string;
}

export class BookingService {
  constructor(
    private readonly db: DB,
    private readonly notifier: Notifier,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  now(): Date {
    return this.clock();
  }

  today(): string {
    return minskToday(this.clock());
  }

  listCabins(): Cabin[] {
    return (this.db.prepare("SELECT * FROM cabins ORDER BY capacity").all() as CabinRow[]).map(toCabin);
  }

  getCabin(id: number): Cabin {
    const row = this.db.prepare("SELECT * FROM cabins WHERE id = ?").get(id) as CabinRow | undefined;
    if (!row) throw notFound("Домик не найден");
    return toCabin(row);
  }

  getBooking(id: number): Booking {
    const row = this.db.prepare(`${BOOKING_SELECT} WHERE b.id = ?`).get(id) as BookingRow | undefined;
    if (!row) throw notFound("Бронь не найдена");
    return toBooking(row);
  }

  listBookings(filter: BookingFilter = {}): Booking[] {
    const where: string[] = [];
    const params: Record<string, string> = {};
    if (filter.status) {
      where.push("b.status = @status");
      params.status = filter.status;
    }
    if (filter.from) {
      where.push("b.check_out > @from");
      params.from = filter.from;
    }
    if (filter.to) {
      where.push("b.check_in < @to");
      params.to = filter.to;
    }
    const sql = `${BOOKING_SELECT} ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY b.check_in, b.id`;
    return (this.db.prepare(sql).all(params) as BookingRow[]).map(toBooking);
  }

  /** Проверяет даты и гостей, возвращает расчёт стоимости. Бросает AppError с понятным текстом. */
  quote(cabinId: number, checkIn: string, checkOut: string, guests: number): PriceQuote & { cabin: Cabin } {
    const cabin = this.getCabin(cabinId);
    this.validateStay(cabin, checkIn, checkOut, guests);
    return { cabin, ...calculateQuote(cabin.basePrice, checkIn, checkOut) };
  }

  isAvailable(cabinId: number, checkIn: string, checkOut: string): boolean {
    const placeholders = BLOCKING_STATUSES.map(() => "?").join(",");
    const overlap = this.db
      .prepare(
        `SELECT 1 FROM bookings
         WHERE cabin_id = ? AND status IN (${placeholders})
           AND check_in < ? AND check_out > ?
         LIMIT 1`,
      )
      .get(cabinId, ...BLOCKING_STATUSES, checkOut, checkIn);
    return !overlap;
  }

  /** Свободные домики на даты с расчётом цены — используется и сайтом, и AI-ассистентом. */
  findAvailable(checkIn: string, checkOut: string, guests: number) {
    return this.listCabins()
      .filter((cabin) => cabin.capacity >= guests)
      .flatMap((cabin) => {
        try {
          this.validateStay(cabin, checkIn, checkOut, guests);
        } catch {
          return [];
        }
        if (!this.isAvailable(cabin.id, checkIn, checkOut)) return [];
        return [{ cabin, quote: calculateQuote(cabin.basePrice, checkIn, checkOut) }];
      });
  }

  /** Занятые ночи домика в месяце 'YYYY-MM' (для календаря на сайте). */
  busyNights(cabinId: number, month: string): string[] {
    this.getCabin(cabinId);
    const start = `${month}-01`;
    const end = addDays(start, 42);
    const rows = this.db
      .prepare(
        `SELECT check_in, check_out FROM bookings
         WHERE cabin_id = ? AND status IN ('pending','confirmed') AND check_in < ? AND check_out > ?`,
      )
      .all(cabinId, end, start) as { check_in: string; check_out: string }[];
    const busy = new Set<string>();
    for (const r of rows) {
      for (const night of eachNight(r.check_in, r.check_out)) {
        if (night >= start && night < end) busy.add(night);
      }
    }
    return [...busy].sort();
  }

  create(input: NewBooking, source: BookingSource, actor: string): Booking {
    const phone = normalizeBelarusPhone(input.phone);
    if (!phone) throw badRequest("invalid_phone", "Укажите белорусский номер телефона, например +375 29 123-45-67");
    const guestName = input.guestName.trim();
    if (guestName.length < 2) throw badRequest("invalid_name", "Укажите имя гостя");

    const now = this.clock().toISOString();

    // IMMEDIATE-транзакция берёт блокировку записи до проверки пересечений,
    // поэтому две одновременные заявки на одни даты не пройдут обе.
    const insert = this.db.transaction((): number => {
      const { cabin, total } = this.quote(input.cabinId, input.checkIn, input.checkOut, input.guests);
      if (!this.isAvailable(cabin.id, input.checkIn, input.checkOut)) {
        throw conflict("dates_taken", "Эти даты уже заняты. Выберите другие или другой домик.");
      }
      const result = this.db
        .prepare(
          `INSERT INTO bookings (code, cabin_id, guest_name, phone, guests, check_in, check_out,
             total, status, source, comment, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
        )
        .run(
          generateCode(),
          cabin.id,
          guestName,
          phone,
          input.guests,
          input.checkIn,
          input.checkOut,
          total,
          source,
          (input.comment ?? "").trim().slice(0, 500),
          now,
          now,
        );
      const id = Number(result.lastInsertRowid);
      this.logEvent(id, "booking.created", actor, { source, total });
      return id;
    });

    const booking = this.getBooking(insert.immediate());
    // Уведомление после коммита: сбой Telegram не должен отменять бронь
    this.notifier.newBooking(booking).catch((err) => console.error("notify newBooking failed", err));
    return booking;
  }

  applyAction(id: number, action: BookingAction, actor: string): Booking {
    const transition = TRANSITIONS[action];
    const booking = this.getBooking(id);
    if (!transition.from.includes(booking.status)) {
      throw new AppError(409, "invalid_transition", `Бронь уже в статусе «${booking.status}»`);
    }
    const now = this.clock().toISOString();
    this.db.transaction(() => {
      const changed = this.db
        .prepare("UPDATE bookings SET status = ?, updated_at = ? WHERE id = ? AND status = ?")
        .run(transition.to, now, id, booking.status);
      // Кто-то успел изменить статус между чтением и записью
      if (changed.changes === 0) throw new AppError(409, "invalid_transition", "Бронь уже обработана");
      this.logEvent(id, `booking.${transition.to}`, actor, { from: booking.status });
    }).immediate();

    const updated = this.getBooking(id);
    this.notifier.statusChanged(updated, actor).catch((err) => console.error("notify statusChanged failed", err));
    return updated;
  }

  logEvent(bookingId: number | null, type: string, actor: string, payload: object = {}): void {
    this.db
      .prepare("INSERT INTO events (booking_id, type, actor, payload, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(bookingId, type, actor, JSON.stringify(payload), this.clock().toISOString());
  }

  private validateStay(cabin: Cabin, checkIn: string, checkOut: string, guests: number): void {
    if (!isIsoDate(checkIn) || !isIsoDate(checkOut)) {
      throw badRequest("invalid_dates", "Даты должны быть в формате ГГГГ-ММ-ДД");
    }
    const today = this.today();
    if (checkIn < today) throw badRequest("past_dates", "Дата заезда уже прошла");
    if (diffDays(today, checkIn) > BOOKING_HORIZON_DAYS) {
      throw badRequest("too_far", "Бронирование открыто на год вперёд");
    }
    const nights = diffDays(checkIn, checkOut);
    if (nights < 1) throw badRequest("invalid_dates", "Дата выезда должна быть позже даты заезда");
    if (nights > MAX_NIGHTS) throw badRequest("too_long", `Максимум ${MAX_NIGHTS} ночей`);
    if (nights < cabin.minNights) {
      throw badRequest("min_nights", `«${cabin.name}» сдаётся минимум на ${cabin.minNights} ночи`);
    }
    if (!Number.isInteger(guests) || guests < 1) throw badRequest("invalid_guests", "Укажите число гостей");
    if (guests > cabin.capacity) {
      throw badRequest("too_many_guests", `«${cabin.name}» вмещает до ${cabin.capacity} гостей`);
    }
  }
}
