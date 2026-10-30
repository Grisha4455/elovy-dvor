import { eachNight, weekday } from "./dates.js";

export const WEEKEND_MARKUP = 0.2;
export const HOLIDAY_MARKUP = 0.3;
export const LONG_STAY_NIGHTS = 7;
export const LONG_STAY_DISCOUNT = 0.1;

// Государственные праздники РБ и канун Нового года (MM-DD)
const HOLIDAYS = new Set([
  "12-31", "01-01", "01-02", "01-07", "03-08", "05-01", "05-09", "07-03", "11-07", "12-25",
]);

export type NightTag = "weekend" | "holiday";

export interface NightPrice {
  date: string;
  price: number;
  tag: NightTag | null;
}

export interface PriceQuote {
  nights: number;
  breakdown: NightPrice[];
  subtotal: number;
  discount: number;
  total: number;
}

function priceNight(basePrice: number, date: string): NightPrice {
  if (HOLIDAYS.has(date.slice(5))) {
    return { date, price: Math.round(basePrice * (1 + HOLIDAY_MARKUP)), tag: "holiday" };
  }
  // Ночи с пятницы на субботу и с субботы на воскресенье
  const day = weekday(date);
  if (day === 5 || day === 6) {
    return { date, price: Math.round(basePrice * (1 + WEEKEND_MARKUP)), tag: "weekend" };
  }
  return { date, price: basePrice, tag: null };
}

export function calculateQuote(basePrice: number, checkIn: string, checkOut: string): PriceQuote {
  const breakdown = eachNight(checkIn, checkOut).map((date) => priceNight(basePrice, date));
  const subtotal = breakdown.reduce((sum, night) => sum + night.price, 0);
  const discount =
    breakdown.length >= LONG_STAY_NIGHTS ? Math.round(subtotal * LONG_STAY_DISCOUNT) : 0;
  return { nights: breakdown.length, breakdown, subtotal, discount, total: subtotal - discount };
}
