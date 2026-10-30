// Демо-данные для локального запуска: пользователи и брони на ближайший месяц.
// Запуск: npm run seed
import { createUser } from "../src/http/auth.js";
import { loadConfig } from "../src/config.js";
import { openDb, seedCabins } from "../src/db.js";
import { addDays } from "../src/domain/dates.js";
import { BookingService } from "../src/services/bookingService.js";
import { NoopNotifier } from "../src/services/notifier.js";

const config = loadConfig();
if (config.NODE_ENV === "production") {
  console.error("Демо-данные нельзя загружать в продакшен-базу");
  process.exit(1);
}

const db = openDb(config.DB_PATH);
seedCabins(db);

await createUser(db, "owner@elovy-dvor.test", "Анна (владелец)", "demo-owner-2026", "owner");
await createUser(db, "manager@elovy-dvor.test", "Игорь (менеджер)", "demo-manager-2026", "manager");

const bookings = new BookingService(db, new NoopNotifier());
const today = bookings.today();
const [shishka, masterskaya, ugol, terem] = bookings.listCabins();

const demo = [
  { cabin: shishka!, in: 1, out: 3, guests: 2, name: "Ольга Сидорович", phone: "+375291112233", source: "assistant", confirm: true },
  { cabin: masterskaya!, in: 0, out: 2, guests: 4, name: "Дмитрий Ковалёв", phone: "+375447654321", source: "site", confirm: true },
  { cabin: ugol!, in: 5, out: 8, guests: 5, name: "Семья Жук", phone: "+375336667788", source: "assistant", confirm: false },
  { cabin: terem!, in: 9, out: 11, guests: 10, name: "ООО «Северный ветер»", phone: "+375173334455", source: "admin", confirm: true },
  { cabin: shishka!, in: 12, out: 19, guests: 2, name: "Мария Ласточкина", phone: "+375259998877", source: "site", confirm: false },
  { cabin: masterskaya!, in: 6, out: 8, guests: 3, name: "Павел Грибов", phone: "+375295554433", source: "assistant", confirm: true },
] as const;

let created = 0;
for (const d of demo) {
  const checkIn = addDays(today, d.in);
  const checkOut = addDays(today, d.out);
  if (!bookings.isAvailable(d.cabin.id, checkIn, checkOut)) continue;
  const b = bookings.create(
    { cabinId: d.cabin.id, checkIn, checkOut, guests: d.guests, guestName: d.name, phone: d.phone },
    d.source,
    "seed",
  );
  if (d.confirm) bookings.applyAction(b.id, "confirm", "seed");
  created++;
}

console.log(`Готово: ${created} демо-броней.`);
console.log("Вход в админку: owner@elovy-dvor.test / demo-owner-2026 (владелец)");
console.log("                manager@elovy-dvor.test / demo-manager-2026 (менеджер)");
