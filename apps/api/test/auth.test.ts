import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createUser } from "../src/http/auth.js";
import { booking, setup } from "./helpers.js";

async function login(app: ReturnType<typeof setup>["app"], email: string, password: string) {
  const res = await request(app).post("/api/auth/login").send({ email, password });
  return res;
}

describe("админка", () => {
  let ctx: ReturnType<typeof setup>;

  beforeEach(async () => {
    ctx = setup();
    await createUser(ctx.db, "owner@test.by", "Анна", "owner-password", "owner");
    await createUser(ctx.db, "manager@test.by", "Игорь", "manager-password", "manager");
  });

  it("закрыта без входа", async () => {
    await request(ctx.app).get("/api/admin/bookings").expect(401);
  });

  it("не пускает с неверным паролем", async () => {
    const res = await login(ctx.app, "owner@test.by", "wrong");
    expect(res.status).toBe(401);
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("ставит httpOnly SameSite=Strict cookie", async () => {
    const res = await login(ctx.app, "owner@test.by", "owner-password");
    expect(res.status).toBe(200);
    const cookie = String(res.headers["set-cookie"]);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
  });

  it("отклоняет поддельный токен", async () => {
    await request(ctx.app)
      .get("/api/admin/bookings")
      .set("Cookie", "ed_session=eyJhbGciOiJub25lIn0.eyJzdWIiOiIxIn0.")
      .expect(401);
  });

  it("менеджер подтверждает заявки, но не видит выручку и не отменяет брони", async () => {
    const b = ctx.bookings.create(booking() as never, "site", "guest");
    const agent = request.agent(ctx.app);
    await agent.post("/api/auth/login").send({ email: "manager@test.by", password: "manager-password" }).expect(200);

    const confirmed = await agent.post(`/api/admin/bookings/${b.id}/confirm`).expect(200);
    expect(confirmed.body.booking.status).toBe("confirmed");
    expect(ctx.notifier.changed[0]?.actor).toBe("admin:manager@test.by");

    await agent.get("/api/admin/stats").expect(403);
    await agent.post(`/api/admin/bookings/${b.id}/cancel`).expect(403);
  });

  it("владелец видит статистику и журнал событий", async () => {
    const b = ctx.bookings.create(booking() as never, "assistant", "assistant");
    ctx.bookings.applyAction(b.id, "confirm", "telegram:anna");
    const agent = request.agent(ctx.app);
    await agent.post("/api/auth/login").send({ email: "owner@test.by", password: "owner-password" }).expect(200);

    const stats = await agent.get("/api/admin/stats").expect(200);
    expect(stats.body).toMatchObject({ revenueConfirmed: 320, pending: 0, bySource: { assistant: 1 } });

    const events = await agent.get("/api/admin/events").expect(200);
    expect(events.body.events.map((e: { type: string }) => e.type)).toEqual(["booking.confirmed", "booking.created"]);
  });

  it("ограничивает перебор паролей", async () => {
    for (let i = 0; i < 10; i++) await login(ctx.app, "owner@test.by", "wrong");
    const res = await login(ctx.app, "owner@test.by", "owner-password");
    expect(res.status).toBe(429);
  });
});
