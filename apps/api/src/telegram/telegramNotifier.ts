import { diffDays, formatRu } from "../domain/dates.js";
import { formatBelarusPhone } from "../domain/phone.js";
import type { Booking } from "../domain/types.js";
import type { Notifier } from "../services/notifier.js";
import { escapeHtml, type TelegramApi } from "./telegramApi.js";

const SOURCE_LABEL: Record<Booking["source"], string> = {
  site: "форма на сайте",
  assistant: "AI-администратор",
  admin: "вручную в админке",
};

const STATUS_LABEL: Record<Booking["status"], string> = {
  pending: "⏳ ждёт подтверждения",
  confirmed: "✅ подтверждена",
  declined: "❌ отклонена",
  cancelled: "🚫 отменена",
  expired: "⌛ истекла без ответа",
};

export function formatBooking(b: Booking): string {
  const nights = diffDays(b.checkIn, b.checkOut);
  const lines = [
    `<b>${escapeHtml(b.cabinName)}</b> · ${b.code}`,
    `📅 ${formatRu(b.checkIn)} → ${formatRu(b.checkOut)} (${nights} ноч.)`,
    `👤 ${escapeHtml(b.guestName)}, гостей: ${b.guests}`,
    `📞 ${formatBelarusPhone(b.phone)}`,
    `💰 ${b.total} руб.`,
    `🔗 ${SOURCE_LABEL[b.source]}`,
  ];
  if (b.comment) lines.push(`💬 ${escapeHtml(b.comment)}`);
  return lines.join("\n");
}

export function statusLine(b: Booking): string {
  return `Статус: ${STATUS_LABEL[b.status]}`;
}

export class TelegramNotifier implements Notifier {
  constructor(
    private readonly api: TelegramApi,
    private readonly chatId: string,
  ) {}

  async newBooking(b: Booking): Promise<void> {
    await this.api.sendMessage(this.chatId, `🆕 <b>Новая заявка</b>\n\n${formatBooking(b)}`, [
      [
        { text: "✅ Подтвердить", callback_data: `confirm:${b.id}` },
        { text: "❌ Отклонить", callback_data: `decline:${b.id}` },
      ],
    ]);
  }

  async statusChanged(b: Booking, actor: string): Promise<void> {
    // Действия из самого Telegram уже видны в отредактированном сообщении
    if (actor.startsWith("telegram:")) return;
    await this.api.sendMessage(this.chatId, `${statusLine(b)}\n\n${formatBooking(b)}`);
  }

  async message(html: string): Promise<void> {
    await this.api.sendMessage(this.chatId, html);
  }
}
