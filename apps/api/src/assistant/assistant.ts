import Anthropic from "@anthropic-ai/sdk";
import { randomUUID } from "node:crypto";
import type { DB } from "../db.js";
import { AppError } from "../errors.js";
import type { BookingService } from "../services/bookingService.js";
import { runTool, toolDefinitions, type ToolContext } from "./tools.js";

type MessageParam = Anthropic.Beta.Messages.BetaMessageParam;
type CreateParams = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type Message = Anthropic.Beta.Messages.BetaMessage;

export type CreateMessage = (params: CreateParams) => Promise<Message>;

/** Максимум запросов к модели на одно сообщение гостя (защита от зацикливания). */
export const MAX_STEPS = 6;
/** Максимум элементов истории в сессии, включая вызовы инструментов. */
export const MAX_HISTORY = 60;

const WEEKDAYS = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];

function systemPrompt(today: string): string {
  const weekday = WEEKDAYS[new Date(`${today}T00:00:00Z`).getUTCDay()];
  return `Ты — онлайн-администратор агроусадьбы «Еловый Двор» (Минская область, 40 минут от Минска).
Сегодня ${today}, ${weekday}. Цены в белорусских рублях (руб.).

Как работать:
- Отвечай по-русски, коротко и дружелюбно, как живой администратор в мессенджере. Без markdown-таблиц.
- Наличие мест и цены бери только из инструментов, никогда не придумывай. Если гость называет даты словами («на эти выходные»), переведи их в конкретные даты и назови их гостю.
- Если подходящего домика нет, предложи соседние даты или другой домик.
- Чтобы оформить заявку, нужны домик, даты, число гостей, имя и телефон. Перед create_booking_request перечисли всё одной строкой с итоговой ценой и дождись явного «да» от гостя.
- После заявки сообщи код брони и что владелец подтвердит её в течение дня. Оплата на месте.
- Заезд с 14:00, выезд до 12:00. С собаками можно в «Медвежий угол» (+20 руб./сутки). Баня есть только в «Еловом тереме».
- На вопросы не про отдых в усадьбе вежливо отвечай, что можешь помочь только с бронированием.`;
}

interface SessionRow {
  id: string;
  messages: string;
  bookings: number;
}

export interface AssistantReply {
  sessionId: string;
  reply: string;
  bookingCode?: string;
}

export class AssistantService {
  constructor(
    private readonly db: DB,
    private readonly bookings: BookingService,
    private readonly createMessage: CreateMessage,
    private readonly model: string,
  ) {}

  async chat(sessionId: string | undefined, userText: string): Promise<AssistantReply> {
    const session = this.loadSession(sessionId);
    if (session.messages.length >= MAX_HISTORY) {
      throw new AppError(409, "session_full", "Диалог получился длинным — начните, пожалуйста, новый.");
    }

    // История хранится на сервере: клиент присылает только текст и не может подделать ответы модели
    const messages = [...session.messages, { role: "user", content: userText } satisfies MessageParam];
    const ctx: ToolContext = { bookings: this.bookings, bookingsCreated: session.bookings };
    let bookingCode: string | undefined;

    try {
      for (let step = 0; step < MAX_STEPS; step++) {
        const response = await this.createMessage({
          model: this.model,
          max_tokens: 16000,
          system: systemPrompt(this.bookings.today()),
          tools: toolDefinitions,
          messages,
          thinking: { type: "adaptive" },
          output_config: { effort: "low" },
          // Если модель откажется отвечать, запрос автоматически повторится на запасной модели
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
        });
        // В историю кладём весь content (включая блоки thinking), а не только текст
        messages.push({ role: "assistant", content: response.content });

        if (response.stop_reason === "refusal") {
          return this.finish(session.id, messages, ctx, "Извините, с этим я помочь не могу. Давайте вернёмся к бронированию?", bookingCode);
        }

        const toolUses = response.content.filter(
          (b): b is Anthropic.Beta.Messages.BetaToolUseBlock => b.type === "tool_use",
        );
        if (response.stop_reason !== "tool_use" || toolUses.length === 0) {
          const text = response.content
            .filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === "text")
            .map((b) => b.text)
            .join("\n")
            .trim();
          return this.finish(session.id, messages, ctx, text || "Уточните, пожалуйста, вопрос.", bookingCode);
        }

        // Все результаты параллельных вызовов возвращаем одним сообщением
        const results: Anthropic.Beta.Messages.BetaToolResultBlockParam[] = toolUses.map((use) => {
          const outcome = runTool(use.name, use.input, ctx);
          bookingCode = outcome.bookingCode ?? bookingCode;
          return { type: "tool_result", tool_use_id: use.id, content: outcome.content, is_error: outcome.isError };
        });
        messages.push({ role: "user", content: results });
      }
      return this.finish(session.id, messages, ctx, "Мне нужно чуть больше времени — напишите, пожалуйста, ещё раз.", bookingCode);
    } catch (err) {
      // Заявку могли успеть создать до сбоя — счётчик сохраняем в любом случае
      this.db.prepare("UPDATE assistant_sessions SET bookings = ? WHERE id = ?").run(ctx.bookingsCreated, session.id);
      throw mapApiError(err);
    }
  }

  private loadSession(id: string | undefined): { id: string; messages: MessageParam[]; bookings: number } {
    if (id) {
      const row = this.db.prepare("SELECT * FROM assistant_sessions WHERE id = ?").get(id) as SessionRow | undefined;
      if (row) return { id: row.id, messages: JSON.parse(row.messages) as MessageParam[], bookings: row.bookings };
    }
    const now = this.bookings.now().toISOString();
    const newId = randomUUID();
    this.db
      .prepare("INSERT INTO assistant_sessions (id, messages, bookings, created_at, updated_at) VALUES (?, '[]', 0, ?, ?)")
      .run(newId, now, now);
    return { id: newId, messages: [], bookings: 0 };
  }

  private finish(
    sessionId: string,
    messages: MessageParam[],
    ctx: ToolContext,
    reply: string,
    bookingCode: string | undefined,
  ): AssistantReply {
    this.db
      .prepare("UPDATE assistant_sessions SET messages = ?, bookings = ?, updated_at = ? WHERE id = ?")
      .run(JSON.stringify(messages), ctx.bookingsCreated, this.bookings.now().toISOString(), sessionId);
    return { sessionId, reply, ...(bookingCode && { bookingCode }) };
  }
}

function mapApiError(err: unknown): unknown {
  if (err instanceof Anthropic.RateLimitError) {
    return new AppError(503, "assistant_busy", "Ассистент сейчас перегружен, попробуйте через минуту.");
  }
  if (err instanceof Anthropic.APIError) {
    console.error("Claude API error", err.status, err.message);
    return new AppError(502, "assistant_unavailable", "Ассистент временно недоступен. Оставьте заявку через форму.");
  }
  return err;
}

export function claudeCreateMessage(apiKey: string): CreateMessage {
  const client = new Anthropic({ apiKey });
  return (params) => client.beta.messages.create(params);
}
