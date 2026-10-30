// Даты бронирований храним как 'YYYY-MM-DD' без времени: ночь = дата заезда.
// В Беларуси нет перехода на летнее время, поэтому «сегодня» считаем по фиксированному UTC+3.
const MINSK_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

function toUtc(value: string): number {
  return Date.parse(`${value}T00:00:00Z`);
}

export function addDays(value: string, days: number): string {
  return new Date(toUtc(value) + days * DAY_MS).toISOString().slice(0, 10);
}

export function diffDays(from: string, to: string): number {
  return Math.round((toUtc(to) - toUtc(from)) / DAY_MS);
}

/** Все ночи проживания: от даты заезда включительно до даты выезда не включительно. */
export function eachNight(checkIn: string, checkOut: string): string[] {
  const nights: string[] = [];
  for (let d = checkIn; d < checkOut; d = addDays(d, 1)) nights.push(d);
  return nights;
}

export function minskToday(now: Date): string {
  return new Date(now.getTime() + MINSK_OFFSET_MS).toISOString().slice(0, 10);
}

export function minskHour(now: Date): number {
  return new Date(now.getTime() + MINSK_OFFSET_MS).getUTCHours();
}

/** 0 = воскресенье ... 6 = суббота */
export function weekday(value: string): number {
  return new Date(toUtc(value)).getUTCDay();
}

export function formatRu(value: string): string {
  const [y, m, d] = value.split("-");
  return `${d}.${m}.${y}`;
}
