import type { DB } from "../db.js";
import { addDays, formatRu, minskHour, minskToday } from "../domain/dates.js";
import type { BookingService } from "../services/bookingService.js";
import type { Notifier } from "../services/notifier.js";
import { computeStats } from "../services/statsService.js";
import { escapeHtml } from "../telegram/telegramApi.js";

/** Сколько часов заявка может ждать ответа владельца, прежде чем даты освободятся. */
export const PENDING_TTL_HOURS = 24;
export const DIGEST_HOUR = 9;
export const SESSION_TTL_HOURS = 24;

export interface JobDeps {
  db: DB;
  bookings: BookingService;
  notifier: Notifier;
}

/** Отмечает задачу выполненной для ключа; false — если уже выполнялась (идемпотентность). */
function claimRun(db: DB, job: string, key: string, now: Date): boolean {
  const res = db
    .prepare("INSERT OR IGNORE INTO job_runs (job, run_key, ran_at) VALUES (?, ?, ?)")
    .run(job, key, now.toISOString());
  return res.changes === 1;
}

/** Заявки без ответа дольше суток истекают, даты снова доступны для гостей. */
export function expireStalePending({ db, bookings, notifier }: JobDeps, now: Date): number {
  const cutoff = new Date(now.getTime() - PENDING_TTL_HOURS * 3600_000).toISOString();
  const stale = db
    .prepare("SELECT id FROM bookings WHERE status = 'pending' AND created_at < ?")
    .all(cutoff) as { id: number }[];
  let expired = 0;
  for (const { id } of stale) {
    try {
      const b = bookings.applyAction(id, "expire", "system");
      expired++;
      void notifier
        .message(`⌛ Заявка ${b.code} (${escapeHtml(b.guestName)}) истекла без ответа — даты снова свободны.`)
        .catch((err) => console.error("notify expire failed", err));
    } catch {
      // Статус изменили параллельно — пропускаем
    }
  }
  return expired;
}

/** Напоминание владельцу накануне заезда: кого встречать и во сколько готовить домик. */
export function sendArrivalReminders({ db, notifier }: JobDeps, now: Date): number {
  const tomorrow = addDays(minskToday(now), 1);
  const rows = db
    .prepare(
      `SELECT b.id, b.code, b.guest_name, b.guests, c.name AS cabin FROM bookings b
       JOIN cabins c ON c.id = b.cabin_id
       WHERE b.status = 'confirmed' AND b.check_in = ? AND b.reminder_sent_at IS NULL`,
    )
    .all(tomorrow) as { id: number; code: string; guest_name: string; guests: number; cabin: string }[];
  if (rows.length === 0) return 0;

  const list = rows
    .map((r) => `• <b>${escapeHtml(r.cabin)}</b> — ${escapeHtml(r.guest_name)}, ${r.guests} гост. (${r.code})`)
    .join("\n");
  const mark = db.prepare("UPDATE bookings SET reminder_sent_at = ? WHERE id = ?");
  db.transaction(() => rows.forEach((r) => mark.run(now.toISOString(), r.id)))();
  void notifier
    .message(`🧹 <b>Завтра заезд (${formatRu(tomorrow)})</b>\nПодготовьте домики:\n${list}`)
    .catch((err) => console.error("notify reminder failed", err));
  return rows.length;
}

export function buildDigest(db: DB, today: string): string {
  const stats = computeStats(db, today, 7);
  const arrivals = db
    .prepare(
      `SELECT b.guest_name, c.name AS cabin FROM bookings b JOIN cabins c ON c.id = b.cabin_id
       WHERE b.status = 'confirmed' AND b.check_in = ?`,
    )
    .all(today) as { guest_name: string; cabin: string }[];
  const departures = db
    .prepare(
      `SELECT c.name AS cabin FROM bookings b JOIN cabins c ON c.id = b.cabin_id
       WHERE b.status = 'confirmed' AND b.check_out = ?`,
    )
    .all(today) as { cabin: string }[];

  const lines = [`☀️ <b>Сводка на ${formatRu(today)}</b>`, ""];
  lines.push(
    arrivals.length
      ? `Заезды: ${arrivals.map((a) => `${escapeHtml(a.cabin)} (${escapeHtml(a.guest_name)})`).join(", ")}`
      : "Заездов сегодня нет",
  );
  lines.push(departures.length ? `Выезды: ${departures.map((d) => escapeHtml(d.cabin)).join(", ")}` : "Выездов нет");
  lines.push(`Ждут подтверждения: ${stats.pending}`);
  lines.push(`Загрузка на 7 дней: ${Math.round(stats.occupancy * 100)}%`);
  lines.push(`Подтверждённая выручка на 7 дней: ${stats.revenueConfirmed} руб.`);
  return lines.join("\n");
}

/** Утренний дайджест — один раз в день после DIGEST_HOUR по Минску. */
export function sendDailyDigest({ db, notifier }: JobDeps, now: Date): boolean {
  if (minskHour(now) < DIGEST_HOUR) return false;
  const today = minskToday(now);
  if (!claimRun(db, "daily-digest", today, now)) return false;
  void notifier.message(buildDigest(db, today)).catch((err) => console.error("notify digest failed", err));
  return true;
}

export function cleanupAssistantSessions({ db }: JobDeps, now: Date): number {
  const cutoff = new Date(now.getTime() - SESSION_TTL_HOURS * 3600_000).toISOString();
  return db.prepare("DELETE FROM assistant_sessions WHERE updated_at < ?").run(cutoff).changes;
}

export function runAllJobs(deps: JobDeps, now: Date) {
  return {
    expired: expireStalePending(deps, now),
    reminders: sendArrivalReminders(deps, now),
    digest: sendDailyDigest(deps, now),
    sessionsCleaned: cleanupAssistantSessions(deps, now),
  };
}

export function startScheduler(deps: JobDeps, intervalMs = 60_000): () => void {
  const tick = () => {
    try {
      runAllJobs(deps, deps.bookings.now());
    } catch (err) {
      console.error("scheduler tick failed", err);
    }
  };
  tick();
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
