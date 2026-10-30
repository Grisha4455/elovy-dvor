export interface Cabin {
  id: number;
  slug: string;
  name: string;
  tagline: string;
  description: string;
  capacity: number;
  basePrice: number;
  minNights: number;
  amenities: string[];
}

export type BookingStatus = "pending" | "confirmed" | "declined" | "cancelled" | "expired";
export type BookingSource = "site" | "assistant" | "admin";

export interface Booking {
  id: number;
  code: string;
  cabinId: number;
  cabinName: string;
  guestName: string;
  phone: string;
  guests: number;
  checkIn: string;
  checkOut: string;
  total: number;
  status: BookingStatus;
  source: BookingSource;
  comment: string;
  createdAt: string;
}

export interface Quote {
  nights: number;
  breakdown: { date: string; price: number; tag: "weekend" | "holiday" | null }[];
  subtotal: number;
  discount: number;
  total: number;
  available: boolean;
}

export interface User {
  id: number;
  email: string;
  name: string;
  role: "owner" | "manager";
}

export interface Stats {
  periodDays: number;
  occupancy: number;
  occupancyByCabin: { cabinId: number; name: string; occupancy: number }[];
  revenueConfirmed: number;
  pending: number;
  bySource: Partial<Record<BookingSource, number>>;
  arrivalsToday: number;
}

export interface EventItem {
  id: number;
  type: string;
  actor: string;
  createdAt: string;
  bookingCode: string | null;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const res = await fetch(`/api${path}`, {
    ...rest,
    credentials: "same-origin",
    headers: json === undefined ? rest.headers : { "content-type": "application/json", ...rest.headers },
    body: json === undefined ? rest.body : JSON.stringify(json),
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? "error", data.message ?? "Что-то пошло не так");
  return data as T;
}

export const api = {
  cabins: () => request<{ cabins: Cabin[] }>("/cabins").then((r) => r.cabins),
  busyNights: (cabinId: number, month: string) =>
    request<{ busy: string[] }>(`/cabins/${cabinId}/availability?month=${month}`).then((r) => r.busy),
  quote: (body: { cabinId: number; checkIn: string; checkOut: string; guests: number }) =>
    request<Quote>("/quote", { method: "POST", json: body }),
  book: (body: Record<string, unknown>) =>
    request<{ code: string; total: number }>("/bookings", { method: "POST", json: body }),
  chat: (sessionId: string | undefined, message: string) =>
    request<{ sessionId: string; reply: string; bookingCode?: string }>("/assistant", {
      method: "POST",
      json: { sessionId, message },
    }),

  me: () => request<{ user: User }>("/auth/me").then((r) => r.user),
  login: (email: string, password: string) =>
    request<{ user: User }>("/auth/login", { method: "POST", json: { email, password } }).then((r) => r.user),
  logout: () => request<void>("/auth/logout", { method: "POST" }),

  bookings: (status?: BookingStatus) =>
    request<{ bookings: Booking[] }>(`/admin/bookings${status ? `?status=${status}` : ""}`).then((r) => r.bookings),
  act: (id: number, action: "confirm" | "decline" | "cancel") =>
    request<{ booking: Booking }>(`/admin/bookings/${id}/${action}`, { method: "POST" }).then((r) => r.booking),
  manualBooking: (body: Record<string, unknown>) =>
    request<{ booking: Booking }>("/admin/bookings", { method: "POST", json: body }).then((r) => r.booking),
  stats: () => request<Stats>("/admin/stats"),
  events: () => request<{ events: EventItem[] }>("/admin/events?limit=30").then((r) => r.events),
};

// ---- даты ----

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const MONTHS_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];

export function formatDay(date: string): string {
  const [, m, d] = date.split("-").map(Number);
  return `${d} ${MONTHS_GEN[(m ?? 1) - 1]}`;
}

export function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

export function formatPhone(phone: string): string {
  const m = /^\+375(\d{2})(\d{3})(\d{2})(\d{2})$/.exec(phone);
  return m ? `+375 (${m[1]}) ${m[2]}-${m[3]}-${m[4]}` : phone;
}

export const rub = (n: number) => `${n.toLocaleString("ru-RU")} руб.`;
