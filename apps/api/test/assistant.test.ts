import request from "supertest";
import { describe, expect, it } from "vitest";
import type { CreateMessage } from "../src/assistant/assistant.js";
import { setup } from "./helpers.js";

type Block = { type: "text"; text: string } | { type: "tool_use"; id: string; name: string; input: unknown };

/** Подменяет Claude API сценарием ответов и записывает, что ему отправили. */
function scripted(...turns: Block[][]) {
  const requests: Parameters<CreateMessage>[0][] = [];
  const createMessage: CreateMessage = async (params) => {
    // Копия: массив messages дальше мутирует сам ассистент
    requests.push(structuredClone(params));
    const content = turns.shift();
    if (!content) throw new Error("сценарий закончился");
    const usesTool = content.some((b) => b.type === "tool_use");
    return { id: "msg", type: "message", role: "assistant", model: params.model, content, stop_reason: usesTool ? "tool_use" : "end_turn" } as never;
  };
  return { createMessage, requests };
}

const stay = { check_in: "2026-11-13", check_out: "2026-11-15", guests: 2 };

describe("AI-администратор", () => {
  it("проверяет наличие через инструмент и отвечает гостю", async () => {
    const { createMessage, requests } = scripted(
      [{ type: "tool_use", id: "t1", name: "check_availability", input: stay }],
      [{ type: "text", text: "На 13–15 ноября свободна «Шишка» за 384 руб." }],
    );
    const { app } = setup({ createMessage });

    const res = await request(app).post("/api/assistant").send({ message: "Есть домик на двоих на эти выходные?" }).expect(200);

    expect(res.body.reply).toContain("Шишка");
    expect(requests).toHaveLength(2);
    const toolResult = (requests[1]!.messages.at(-1)!.content as { type: string; content: string }[])[0]!;
    expect(toolResult.type).toBe("tool_result");
    const available = JSON.parse(toolResult.content).available as { name: string; total: number }[];
    expect(available.find((c) => c.name === "Шишка")?.total).toBe(384);
  });

  it("создаёт заявку и передаёт её владельцу", async () => {
    const { createMessage } = scripted(
      [
        {
          type: "tool_use",
          id: "t1",
          name: "create_booking_request",
          input: { cabin_id: 1, ...stay, guest_name: "Ольга", phone: "80291234567", comment: "" },
        },
      ],
      [{ type: "text", text: "Готово! Код брони пришлю ниже." }],
    );
    const { app, notifier } = setup({ createMessage });

    const res = await request(app).post("/api/assistant").send({ message: "Да, бронируйте" }).expect(200);

    expect(res.body.bookingCode).toMatch(/^ED-/);
    expect(notifier.created[0]).toMatchObject({ source: "assistant", phone: "+375291234567" });
  });

  it("возвращает модели бизнес-ошибку, а не падает", async () => {
    const { createMessage, requests } = scripted(
      [{ type: "tool_use", id: "t1", name: "get_quote", input: { cabin_id: 1, ...stay, guests: 5 } }],
      [{ type: "text", text: "«Шишка» только для двоих." }],
    );
    const { app } = setup({ createMessage });
    await request(app).post("/api/assistant").send({ message: "Шишка на пятерых" }).expect(200);

    const result = (requests[1]!.messages.at(-1)!.content as { is_error: boolean; content: string }[])[0]!;
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("вмещает до 2");
  });

  it("хранит историю на сервере и продолжает диалог по sessionId", async () => {
    const { createMessage, requests } = scripted(
      [{ type: "text", text: "Здравствуйте! На какие даты?" }],
      [{ type: "text", text: "Отлично, проверяю." }],
    );
    const { app } = setup({ createMessage });

    const first = await request(app).post("/api/assistant").send({ message: "Привет" }).expect(200);
    await request(app).post("/api/assistant").send({ sessionId: first.body.sessionId, message: "13–15 ноября" }).expect(200);

    expect(requests[1]!.messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
  });

  it("не даёт создать больше двух заявок за диалог", async () => {
    const create = (id: string) => ({
      type: "tool_use" as const,
      id,
      name: "create_booking_request",
      input: { cabin_id: 4, check_in: "2026-11-20", check_out: "2026-11-22", guests: 2, guest_name: "Бот", phone: "+375291234567", comment: "" },
    });
    const { createMessage, requests } = scripted(
      [create("a")],
      [{ ...create("b"), input: { ...create("b").input, cabin_id: 2 } }],
      [{ ...create("c"), input: { ...create("c").input, cabin_id: 3 } }],
      [{ type: "text", text: "Лимит" }],
    );
    const { app, notifier } = setup({ createMessage });
    await request(app).post("/api/assistant").send({ message: "забронируй всё" }).expect(200);

    expect(notifier.created).toHaveLength(2);
    const last = (requests[3]!.messages.at(-1)!.content as { is_error: boolean }[])[0]!;
    expect(last.is_error).toBe(true);
  });

  it("сообщает, что ассистент выключен, если нет API-ключа", async () => {
    const { app } = setup();
    await request(app).post("/api/assistant").send({ message: "Привет" }).expect(503);
  });
});
