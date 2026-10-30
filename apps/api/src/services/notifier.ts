import type { Booking } from "../domain/types.js";

/**
 * Канал уведомлений владельца. В продакшене — Telegram, в тестах — запись в массив.
 * Сервис бронирований не знает, куда уходят сообщения.
 */
export interface Notifier {
  newBooking(booking: Booking): Promise<void>;
  statusChanged(booking: Booking, actor: string): Promise<void>;
  message(html: string): Promise<void>;
}

export class NoopNotifier implements Notifier {
  async newBooking(): Promise<void> {}
  async statusChanged(): Promise<void> {}
  async message(): Promise<void> {}
}
