import request from "supertest";
import { describe, expect, it } from "vitest";
import { booking, setup } from "./helpers.js";

describe("POST /api/bookings", () => {
  it("создаёт заявку, считает цену и уведомляет владельца", async () => {
    const { app, notifier } = setup();
    const res = await request(app).post("/api/bookings").send(booking()).expect(201);
    expect(res.body).toEqual({ code: expect.stringMatching(/^ED-[A-Z0-9]{6}$/), status: "pending", total: 320 });
    expect(notifier.created).toHaveLength(1);
    expect(notifier.created[0]).toMatchObject({ phone: "+375291234567", source: "site" });
  });

  it("не даёт забронировать пересекающиеся даты", async () => {
    const { app } = setup();
    await request(app).post("/api/bookings").send(booking()).expect(201);
    const res = await request(app)
      .post("/api/bookings")
      .send(booking({ checkIn: "2026-11-11", checkOut: "2026-11-13" }))
      .expect(409);
    expect(res.body.error).toBe("dates_taken");
  });

  it("разрешает заезд в день выезда предыдущих гостей", async () => {
    const { app } = setup();
    await request(app).post("/api/bookings").send(booking()).expect(201);
    await request(app).post("/api/bookings").send(booking({ checkIn: "2026-11-12", checkOut: "2026-11-13" })).expect(201);
  });

  it("освобождает даты после отклонения заявки", () => {
    const { bookings } = setup();
    const first = bookings.create(booking() as never, "site", "guest");
    bookings.applyAction(first.id, "decline", "admin:test");
    expect(bookings.isAvailable(1, "2026-11-10", "2026-11-12")).toBe(true);
  });

  it.each([
    [{ checkIn: "2026-10-30" }, "past_dates"],
    [{ checkOut: "2026-11-10" }, "invalid_dates"],
    [{ guests: 3 }, "too_many_guests"],
    [{ cabinId: 3, checkOut: "2026-11-11" }, "min_nights"],
    [{ phone: "+7 999 000-00-00" }, "invalid_phone"],
  ])("отклоняет некорректную заявку %o", async (overrides, code) => {
    const { app } = setup();
    const res = await request(app).post("/api/bookings").send(booking(overrides)).expect(400);
    expect(res.body.error).toBe(code);
  });

  it("молча игнорирует ботов, заполнивших поле-ловушку", async () => {
    const { app, notifier } = setup();
    await request(app).post("/api/bookings").send(booking({ website: "http://spam" })).expect(201);
    expect(notifier.created).toHaveLength(0);
  });

  it("ограничивает частоту заявок с одного IP", async () => {
    const { app } = setup();
    for (let i = 0; i < 5; i++) {
      await request(app).post("/api/bookings").send(booking({ website: "x" }));
    }
    await request(app).post("/api/bookings").send(booking()).expect(429);
  });

  it("отклоняет запрос с чужого Origin", async () => {
    const { app } = setup();
    await request(app).post("/api/bookings").set("Origin", "https://evil.example").send(booking()).expect(403);
  });
});

describe("календарь занятости", () => {
  it("возвращает занятые ночи месяца", async () => {
    const { app, bookings } = setup();
    bookings.create(booking({ checkIn: "2026-11-29", checkOut: "2026-12-02" }) as never, "site", "guest");
    const res = await request(app).get("/api/cabins/1/availability?month=2026-12").expect(200);
    expect(res.body.busy).toEqual(["2026-12-01"]);
  });
});

describe("переходы статусов", () => {
  it("нельзя подтвердить уже отклонённую заявку", () => {
    const { bookings } = setup();
    const b = bookings.create(booking() as never, "site", "guest");
    bookings.applyAction(b.id, "decline", "admin");
    expect(() => bookings.applyAction(b.id, "confirm", "admin")).toThrow(/статусе/);
  });
});
