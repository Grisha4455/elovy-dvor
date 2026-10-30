import { describe, expect, it } from "vitest";
import { runAllJobs, sendDailyDigest } from "../src/automation/jobs.js";
import { booking, NOW, setup } from "./helpers.js";

describe("автоматизация", () => {
  it("заявка без ответа истекает через 24 часа и освобождает даты", () => {
    const ctx = setup();
    const b = ctx.bookings.create(booking() as never, "site", "guest");

    const later = new Date(NOW.getTime() + 25 * 3600_000);
    ctx.setNow(later);
    const result = runAllJobs(ctx, later);

    expect(result.expired).toBe(1);
    expect(ctx.bookings.getBooking(b.id).status).toBe("expired");
    expect(ctx.bookings.isAvailable(1, "2026-11-10", "2026-11-12")).toBe(true);
    expect(ctx.notifier.messages.some((m) => m.includes("истекла"))).toBe(true);
  });

  it("напоминает о завтрашнем заезде ровно один раз", () => {
    const ctx = setup();
    const b = ctx.bookings.create(booking({ checkIn: "2026-11-03", checkOut: "2026-11-04" }) as never, "site", "guest");
    ctx.bookings.applyAction(b.id, "confirm", "admin");

    expect(runAllJobs(ctx, NOW).reminders).toBe(1);
    expect(runAllJobs(ctx, NOW).reminders).toBe(0);
    expect(ctx.notifier.messages.find((m) => m.includes("Завтра заезд"))).toContain("Шишка");
  });

  it("шлёт утренний дайджест один раз в день и не раньше 9:00", () => {
    const ctx = setup();
    const early = new Date("2026-11-02T05:00:00Z"); // 08:00 по Минску
    expect(sendDailyDigest(ctx, early)).toBe(false);
    expect(sendDailyDigest(ctx, NOW)).toBe(true);
    expect(sendDailyDigest(ctx, NOW)).toBe(false);
    expect(ctx.notifier.messages[0]).toContain("Сводка на 02.11.2026");
  });
});
