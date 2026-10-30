import type { Booking } from "../src/domain/types.js";
import { createApp } from "../src/app.js";
import { AssistantService, type CreateMessage } from "../src/assistant/assistant.js";
import { loadConfig } from "../src/config.js";
import { openDb, seedCabins } from "../src/db.js";
import { BookingService } from "../src/services/bookingService.js";
import type { Notifier } from "../src/services/notifier.js";
import type { TelegramApi } from "../src/telegram/telegramApi.js";

export class RecordingNotifier implements Notifier {
  created: Booking[] = [];
  changed: { booking: Booking; actor: string }[] = [];
  messages: string[] = [];
  async newBooking(b: Booking) {
    this.created.push(b);
  }
  async statusChanged(booking: Booking, actor: string) {
    this.changed.push({ booking, actor });
  }
  async message(html: string) {
    this.messages.push(html);
  }
}

// Понедельник, 2 ноября 2026, 11:00 по Минску
export const NOW = new Date("2026-11-02T08:00:00Z");

export const TEST_ENV = {
  NODE_ENV: "test",
  JWT_SECRET: "test-secret-that-is-long-enough-1234567890",
  WEB_ORIGIN: "http://localhost:5173",
  TELEGRAM_CHAT_ID: "1001",
  TELEGRAM_WEBHOOK_SECRET: "webhook-secret-123456",
};

export function setup(options: { now?: Date; createMessage?: CreateMessage; telegram?: TelegramApi } = {}) {
  let now = options.now ?? NOW;
  const clock = () => now;
  const config = loadConfig(TEST_ENV);
  const db = openDb(":memory:");
  seedCabins(db);
  const notifier = new RecordingNotifier();
  const bookings = new BookingService(db, notifier, clock);
  const assistant = options.createMessage
    ? new AssistantService(db, bookings, options.createMessage, "claude-opus-5-5")
    : null;
  const app = createApp({ config, db, bookings, assistant, telegram: options.telegram ?? null });
  return {
    app,
    db,
    bookings,
    notifier,
    setNow: (d: Date) => {
      now = d;
    },
  };
}

export const booking = (overrides: Partial<Record<string, unknown>> = {}) => ({
  cabinId: 1,
  checkIn: "2026-11-10",
  checkOut: "2026-11-12",
  guests: 2,
  guestName: "Ольга",
  phone: "+375 29 123-45-67",
  ...overrides,
});
