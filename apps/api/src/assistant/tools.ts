import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { AppError } from "../errors.js";
import type { BookingService } from "../services/bookingService.js";

export const MAX_BOOKINGS_PER_SESSION = 2;

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// Каждый инструмент: JSON Schema для модели + zod-схема для повторной проверки на сервере.
// strict: true заставляет модель соблюдать схему, но вход от модели всё равно считаем недоверенным.
const schemas = {
  list_cabins: z.object({}),
  check_availability: z.object({
    check_in: date,
    check_out: date,
    guests: z.number().int().min(1).max(30),
  }),
  get_quote: z.object({
    cabin_id: z.number().int(),
    check_in: date,
    check_out: date,
    guests: z.number().int().min(1).max(30),
  }),
  create_booking_request: z.object({
    cabin_id: z.number().int(),
    check_in: date,
    check_out: date,
    guests: z.number().int().min(1).max(30),
    guest_name: z.string().min(2).max(80),
    phone: z.string().min(7).max(30),
    comment: z.string().max(500),
  }),
};

type ToolName = keyof typeof schemas;

const stayProperties = {
  check_in: { type: "string", description: "Дата заезда, YYYY-MM-DD" },
  check_out: { type: "string", description: "Дата выезда, YYYY-MM-DD (позже заезда)" },
  guests: { type: "integer", description: "Количество гостей, включая детей" },
} as const;

export const toolDefinitions: Anthropic.Beta.BetaTool[] = [
  {
    name: "list_cabins",
    description:
      "Список всех домиков усадьбы: вместимость, цена за ночь в будни, минимальный срок, удобства. " +
      "Используй, когда гость спрашивает, какие есть варианты, или без дат.",
    strict: true,
    input_schema: { type: "object", properties: {}, required: [], additionalProperties: false },
  },
  {
    name: "check_availability",
    description:
      "Находит домики, свободные на указанные даты и подходящие по числу гостей, с итоговой стоимостью. " +
      "Вызывай всегда, прежде чем говорить гостю, что даты свободны.",
    strict: true,
    input_schema: {
      type: "object",
      properties: stayProperties,
      required: ["check_in", "check_out", "guests"],
      additionalProperties: false,
    },
  },
  {
    name: "get_quote",
    description: "Точный расчёт стоимости конкретного домика по ночам: будни, выходные, праздники, скидка за 7+ ночей.",
    strict: true,
    input_schema: {
      type: "object",
      properties: { cabin_id: { type: "integer" }, ...stayProperties },
      required: ["cabin_id", "check_in", "check_out", "guests"],
      additionalProperties: false,
    },
  },
  {
    name: "create_booking_request",
    description:
      "Создаёт заявку на бронь со статусом «ждёт подтверждения»; владелец подтверждает её в Telegram. " +
      "Вызывай только после того, как гость явно подтвердил домик, даты, число гостей, имя и телефон.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        cabin_id: { type: "integer" },
        ...stayProperties,
        guest_name: { type: "string", description: "Имя гостя" },
        phone: { type: "string", description: "Телефон гостя в любом формате, белорусский номер" },
        comment: { type: "string", description: "Пожелания гостя; пустая строка, если их нет" },
      },
      required: ["cabin_id", "check_in", "check_out", "guests", "guest_name", "phone", "comment"],
      additionalProperties: false,
    },
  },
];

export interface ToolContext {
  bookings: BookingService;
  /** Сколько заявок уже создано в этой сессии — защита от спама через ассистента */
  bookingsCreated: number;
}

export interface ToolOutcome {
  content: string;
  isError: boolean;
  bookingCode?: string;
}

export function runTool(name: string, rawInput: unknown, ctx: ToolContext): ToolOutcome {
  if (!(name in schemas)) return { content: `Неизвестный инструмент ${name}`, isError: true };
  const parsed = schemas[name as ToolName].safeParse(rawInput);
  if (!parsed.success) {
    return { content: `Неверные параметры: ${parsed.error.issues.map((i) => i.message).join("; ")}`, isError: true };
  }
  try {
    return execute(name as ToolName, parsed.data, ctx);
  } catch (err) {
    // Бизнес-ошибки («даты заняты», «минимум 2 ночи») возвращаем модели — она объяснит их гостю
    if (err instanceof AppError) return { content: err.message, isError: true };
    throw err;
  }
}

function execute(name: ToolName, input: any, ctx: ToolContext): ToolOutcome {
  const { bookings } = ctx;
  switch (name) {
    case "list_cabins": {
      const cabins = bookings.listCabins().map((c) => ({
        cabin_id: c.id,
        name: c.name,
        tagline: c.tagline,
        capacity: c.capacity,
        weekday_price_per_night: c.basePrice,
        min_nights: c.minNights,
        amenities: c.amenities,
      }));
      return { content: JSON.stringify({ currency: "BYN", cabins }), isError: false };
    }
    case "check_availability": {
      const free = bookings.findAvailable(input.check_in, input.check_out, input.guests).map(({ cabin, quote }) => ({
        cabin_id: cabin.id,
        name: cabin.name,
        capacity: cabin.capacity,
        nights: quote.nights,
        total: quote.total,
        discount: quote.discount,
      }));
      return { content: JSON.stringify({ currency: "BYN", available: free }), isError: false };
    }
    case "get_quote": {
      const q = bookings.quote(input.cabin_id, input.check_in, input.check_out, input.guests);
      const available = bookings.isAvailable(input.cabin_id, input.check_in, input.check_out);
      return {
        content: JSON.stringify({
          currency: "BYN",
          cabin: q.cabin.name,
          available,
          nights: q.breakdown,
          subtotal: q.subtotal,
          discount: q.discount,
          total: q.total,
        }),
        isError: false,
      };
    }
    case "create_booking_request": {
      if (ctx.bookingsCreated >= MAX_BOOKINGS_PER_SESSION) {
        return {
          content: "Лимит заявок в одном диалоге исчерпан. Предложи гостю позвонить администратору.",
          isError: true,
        };
      }
      const booking = bookings.create(
        {
          cabinId: input.cabin_id,
          checkIn: input.check_in,
          checkOut: input.check_out,
          guests: input.guests,
          guestName: input.guest_name,
          phone: input.phone,
          comment: input.comment,
        },
        "assistant",
        "assistant",
      );
      ctx.bookingsCreated++;
      return {
        content: JSON.stringify({
          code: booking.code,
          status: "pending",
          total: booking.total,
          note: "Владелец подтвердит заявку в течение дня и перезвонит гостю.",
        }),
        isError: false,
        bookingCode: booking.code,
      };
    }
  }
}
