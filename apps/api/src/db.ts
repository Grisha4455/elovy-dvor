import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type DB = Database.Database;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS cabins (
  id          INTEGER PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  tagline     TEXT NOT NULL,
  description TEXT NOT NULL,
  capacity    INTEGER NOT NULL CHECK (capacity > 0),
  base_price  INTEGER NOT NULL CHECK (base_price > 0),
  min_nights  INTEGER NOT NULL DEFAULT 1,
  amenities   TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS bookings (
  id               INTEGER PRIMARY KEY,
  code             TEXT NOT NULL UNIQUE,
  cabin_id         INTEGER NOT NULL REFERENCES cabins(id),
  guest_name       TEXT NOT NULL,
  phone            TEXT NOT NULL,
  guests           INTEGER NOT NULL,
  check_in         TEXT NOT NULL,
  check_out        TEXT NOT NULL,
  total            INTEGER NOT NULL,
  status           TEXT NOT NULL CHECK (status IN ('pending','confirmed','declined','cancelled','expired')),
  source           TEXT NOT NULL CHECK (source IN ('site','assistant','admin')),
  comment          TEXT NOT NULL DEFAULT '',
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  reminder_sent_at TEXT,
  CHECK (check_out > check_in)
);
CREATE INDEX IF NOT EXISTS bookings_cabin_dates ON bookings (cabin_id, check_in, check_out);
CREATE INDEX IF NOT EXISTS bookings_status ON bookings (status);

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('owner','manager'))
);

CREATE TABLE IF NOT EXISTS events (
  id         INTEGER PRIMARY KEY,
  booking_id INTEGER REFERENCES bookings(id),
  type       TEXT NOT NULL,
  actor      TEXT NOT NULL,
  payload    TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS assistant_sessions (
  id         TEXT PRIMARY KEY,
  messages   TEXT NOT NULL,
  bookings   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Защита от повторного запуска периодических задач (например, дайджест раз в день)
CREATE TABLE IF NOT EXISTS job_runs (
  job     TEXT NOT NULL,
  run_key TEXT NOT NULL,
  ran_at  TEXT NOT NULL,
  PRIMARY KEY (job, run_key)
);
`;

export function openDb(path: string): DB {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  db.exec(SCHEMA);
  return db;
}

export const DEFAULT_CABINS = [
  {
    slug: "shishka",
    name: "Шишка",
    tagline: "A-frame для двоих с панорамным окном в лес",
    description:
      "Маленький треугольный домик на краю ельника. Двуспальная кровать под скатом крыши, печка-буржуйка, терраса с видом на рассвет.",
    capacity: 2,
    base_price: 160,
    min_nights: 1,
    amenities: ["печь", "терраса", "кофемашина", "Wi-Fi"],
  },
  {
    slug: "lesnaya-masterskaya",
    name: "Лесная мастерская",
    tagline: "Дом на 4 гостей с камином и мастерской",
    description:
      "Бывшая столярная мастерская, перестроенная в уютный дом. Две спальни, камин, большой стол из цельного дуба.",
    capacity: 4,
    base_price: 240,
    min_nights: 1,
    amenities: ["камин", "кухня", "мангал", "Wi-Fi"],
  },
  {
    slug: "medvezhiy-ugol",
    name: "Медвежий угол",
    tagline: "Семейный дом на 6 гостей у пруда",
    description:
      "Сруб из северной сосны в двадцати шагах от пруда. Три спальни, детская зона, собственный причал и лодка.",
    capacity: 6,
    base_price: 320,
    min_nights: 2,
    amenities: ["причал", "лодка", "детская зона", "кухня", "мангал"],
  },
  {
    slug: "eloviy-terem",
    name: "Еловый терем",
    tagline: "Большой дом с баней для компании до 12 человек",
    description:
      "Двухэтажный терем с банкетным залом, баней на дровах и купелью. Подходит для дней рождения и корпоративов.",
    capacity: 12,
    base_price: 560,
    min_nights: 2,
    amenities: ["баня", "купель", "банкетный зал", "караоке", "мангал"],
  },
];

export function seedCabins(db: DB): void {
  const insert = db.prepare(
    `INSERT OR IGNORE INTO cabins (slug, name, tagline, description, capacity, base_price, min_nights, amenities)
     VALUES (@slug, @name, @tagline, @description, @capacity, @base_price, @min_nights, @amenities)`,
  );
  db.transaction(() => {
    for (const cabin of DEFAULT_CABINS) {
      insert.run({ ...cabin, amenities: JSON.stringify(cabin.amenities) });
    }
  })();
}
