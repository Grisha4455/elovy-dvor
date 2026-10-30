import type { DB } from "../db.js";
import { addDays, diffDays, eachNight } from "../domain/dates.js";

export interface Stats {
  periodDays: number;
  occupancy: number;
  occupancyByCabin: { cabinId: number; name: string; occupancy: number }[];
  revenueConfirmed: number;
  pending: number;
  bySource: Record<string, number>;
  arrivalsToday: number;
}

/** Метрики на ближайшие `periodDays` дней от `today`. */
export function computeStats(db: DB, today: string, periodDays = 30): Stats {
  const end = addDays(today, periodDays);
  const cabins = db.prepare("SELECT id, name FROM cabins ORDER BY capacity").all() as { id: number; name: string }[];
  const rows = db
    .prepare(
      `SELECT cabin_id, check_in, check_out, total, status FROM bookings
       WHERE status IN ('pending','confirmed') AND check_in < ? AND check_out > ?`,
    )
    .all(end, today) as { cabin_id: number; check_in: string; check_out: string; total: number; status: string }[];

  const busyByCabin = new Map<number, number>();
  let revenueConfirmed = 0;
  for (const r of rows) {
    const nights = eachNight(r.check_in, r.check_out).filter((n) => n >= today && n < end).length;
    if (r.status === "confirmed") {
      busyByCabin.set(r.cabin_id, (busyByCabin.get(r.cabin_id) ?? 0) + nights);
      // Выручку распределяем по ночам, попавшим в период
      revenueConfirmed += Math.round((r.total * nights) / diffDays(r.check_in, r.check_out));
    }
  }

  const occupancyByCabin = cabins.map((c) => ({
    cabinId: c.id,
    name: c.name,
    occupancy: (busyByCabin.get(c.id) ?? 0) / periodDays,
  }));
  const occupancy =
    occupancyByCabin.reduce((sum, c) => sum + c.occupancy, 0) / Math.max(cabins.length, 1);

  const bySource = Object.fromEntries(
    (
      db
        .prepare("SELECT source, COUNT(*) AS n FROM bookings WHERE created_at >= ? GROUP BY source")
        .all(addDays(today, -30)) as { source: string; n: number }[]
    ).map((r) => [r.source, r.n]),
  );

  const { pending } = db
    .prepare("SELECT COUNT(*) AS pending FROM bookings WHERE status = 'pending'")
    .get() as { pending: number };
  const { arrivals } = db
    .prepare("SELECT COUNT(*) AS arrivals FROM bookings WHERE status = 'confirmed' AND check_in = ?")
    .get(today) as { arrivals: number };

  return {
    periodDays,
    occupancy,
    occupancyByCabin,
    revenueConfirmed,
    pending,
    bySource,
    arrivalsToday: arrivals,
  };
}
