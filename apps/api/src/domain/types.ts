export type BookingStatus = "pending" | "confirmed" | "declined" | "cancelled" | "expired";
export type BookingSource = "site" | "assistant" | "admin";
export type BookingAction = "confirm" | "decline" | "cancel" | "expire";
export type Role = "owner" | "manager";

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
  updatedAt: string;
}

export interface NewBooking {
  cabinId: number;
  checkIn: string;
  checkOut: string;
  guests: number;
  guestName: string;
  phone: string;
  comment?: string;
}

// Какие переходы статуса разрешены: из чего → во что
export const TRANSITIONS: Record<BookingAction, { from: BookingStatus[]; to: BookingStatus }> = {
  confirm: { from: ["pending"], to: "confirmed" },
  decline: { from: ["pending"], to: "declined" },
  cancel: { from: ["pending", "confirmed"], to: "cancelled" },
  expire: { from: ["pending"], to: "expired" },
};

// Статусы, которые занимают даты в календаре
export const BLOCKING_STATUSES: BookingStatus[] = ["pending", "confirmed"];
