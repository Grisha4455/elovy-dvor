import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { TelegramApi } from "../src/telegram/telegramApi.js";
import { formatBooking } from "../src/telegram/telegramNotifier.js";
import { booking, setup, TEST_ENV } from "./helpers.js";

function fakeTelegram() {
  const calls: { method: string; body: Record<string, unknown> }[] = [];
  const api = new TelegramApi("token");
  vi.spyOn(api, "call").mockImplementation(async (method, body) => {
    calls.push({ method, body });
    return {} as never;
  });
  return { api, calls };
}

const callback = (data: string, chatId = 1001) => ({
  callback_query: {
    id: "cb1",
    data,
    from: { id: 7, username: "anna" },
    message: { message_id: 55, chat: { id: chatId } },
  },
});

describe("Telegram webhook", () => {
  it("отклоняет запросы без секретного заголовка", async () => {
    const { app } = setup({ telegram: fakeTelegram().api });
    await request(app).post("/api/telegram/webhook").send(callback("confirm:1")).expect(401);
    await request(app)
      .post("/api/telegram/webhook")
      .set("X-Telegram-Bot-Api-Secret-Token", "wrong-secret-value!!")
      .send(callback("confirm:1"))
      .expect(401);
  });

  it("подтверждает бронь по нажатию кнопки и обновляет сообщение", async () => {
    const tg = fakeTelegram();
    const { app, bookings } = setup({ telegram: tg.api });
    const b = bookings.create(booking() as never, "site", "guest");

    await request(app)
      .post("/api/telegram/webhook")
      .set("X-Telegram-Bot-Api-Secret-Token", TEST_ENV.TELEGRAM_WEBHOOK_SECRET)
      .send(callback(`confirm:${b.id}`))
      .expect(200);

    expect(bookings.getBooking(b.id).status).toBe("confirmed");
    expect(tg.calls.map((c) => c.method)).toEqual(["editMessageText", "answerCallbackQuery"]);
    expect(String(tg.calls[0]?.body.text)).toContain("подтверждена");
  });

  it("игнорирует нажатия из чужих чатов", async () => {
    const tg = fakeTelegram();
    const { app, bookings } = setup({ telegram: tg.api });
    const b = bookings.create(booking() as never, "site", "guest");

    await request(app)
      .post("/api/telegram/webhook")
      .set("X-Telegram-Bot-Api-Secret-Token", TEST_ENV.TELEGRAM_WEBHOOK_SECRET)
      .send(callback(`confirm:${b.id}`, 999))
      .expect(200);

    expect(bookings.getBooking(b.id).status).toBe("pending");
    expect(tg.calls).toHaveLength(0);
  });

  it("повторное нажатие сообщает, что заявка уже обработана", async () => {
    const tg = fakeTelegram();
    const { app, bookings } = setup({ telegram: tg.api });
    const b = bookings.create(booking() as never, "site", "guest");
    bookings.applyAction(b.id, "decline", "admin");

    await request(app)
      .post("/api/telegram/webhook")
      .set("X-Telegram-Bot-Api-Secret-Token", TEST_ENV.TELEGRAM_WEBHOOK_SECRET)
      .send(callback(`confirm:${b.id}`))
      .expect(200);

    expect(tg.calls).toEqual([{ method: "answerCallbackQuery", body: expect.objectContaining({ text: expect.stringMatching(/статусе/) }) }]);
  });
});

describe("formatBooking", () => {
  it("экранирует HTML из данных гостя", () => {
    const { bookings } = setup();
    const b = bookings.create(booking({ guestName: "<b>Хакер</b>", comment: "<a href=x>" }) as never, "site", "guest");
    const html = formatBooking(b);
    expect(html).toContain("&lt;b&gt;Хакер&lt;/b&gt;");
    expect(html).not.toContain("<a href");
  });
});
