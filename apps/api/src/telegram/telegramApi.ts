export type InlineKeyboard = { text: string; callback_data: string }[][];

export class TelegramApi {
  constructor(
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async call<T = unknown>(method: string, body: Record<string, unknown>): Promise<T> {
    const res = await this.fetchImpl(`https://api.telegram.org/bot${this.token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    const data = (await res.json()) as { ok: boolean; result?: T; description?: string };
    // В тексте ошибки нет токена: в URL он есть, поэтому URL не логируем
    if (!data.ok) throw new Error(`Telegram ${method}: ${data.description ?? res.status}`);
    return data.result as T;
  }

  sendMessage(chatId: string, html: string, keyboard?: InlineKeyboard) {
    return this.call("sendMessage", {
      chat_id: chatId,
      text: html,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      ...(keyboard && { reply_markup: { inline_keyboard: keyboard } }),
    });
  }

  editMessageText(chatId: string | number, messageId: number, html: string) {
    return this.call("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text: html,
      parse_mode: "HTML",
    });
  }

  answerCallbackQuery(id: string, text: string) {
    return this.call("answerCallbackQuery", { callback_query_id: id, text });
  }
}

/** Экранирование для parse_mode=HTML: данные гостя нельзя вставлять в разметку как есть. */
export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
