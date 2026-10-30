import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import {
  addDays,
  api,
  ApiError,
  formatDay,
  formatPhone,
  rub,
  todayIso,
  type Booking,
  type BookingStatus,
  type Cabin,
  type EventItem,
  type Stats,
  type User,
} from "../api";
import { Occupancy } from "../components/Occupancy";

const STATUS: Record<BookingStatus, string> = {
  pending: "ждёт ответа",
  confirmed: "подтверждена",
  declined: "отклонена",
  cancelled: "отменена",
  expired: "истекла",
};

const SOURCE = { site: "сайт", assistant: "AI-чат", admin: "по телефону" } as const;

const EVENT: Record<string, string> = {
  "booking.created": "новая заявка",
  "booking.confirmed": "подтверждена",
  "booking.declined": "отклонена",
  "booking.cancelled": "отменена",
  "booking.expired": "истекла автоматически",
};

function actorLabel(actor: string): string {
  if (actor === "system") return "автоматизация";
  if (actor === "assistant") return "AI-администратор";
  if (actor === "guest") return "гость на сайте";
  if (actor === "seed") return "демо-данные";
  if (actor.startsWith("telegram:")) return `Telegram @${actor.slice(9)}`;
  if (actor.startsWith("admin:")) return actor.slice(6);
  return actor;
}

export function Admin() {
  const [user, setUser] = useState<User | null | undefined>(undefined);

  useEffect(() => {
    api.me().then(setUser).catch(() => setUser(null));
  }, []);

  if (user === undefined) return <div className="admin-loading">Загрузка…</div>;
  if (!user) return <Login onLogin={setUser} />;
  return <Dashboard user={user} onLogout={() => setUser(null)} />;
}

function Login({ onLogin }: { onLogin: (u: User) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      onLogin(await api.login(email, password));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Ошибка входа");
    }
  };

  return (
    <div className="login-wrap">
      <form className="panel login" onSubmit={submit}>
        <h1>Кабинет владельца</h1>
        <p className="muted small">Демо: owner@elovy-dvor.test / demo-owner-2026</p>
        <label className="field">
          <span className="label">Email</span>
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
        </label>
        <label className="field">
          <span className="label">Пароль</span>
          <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="btn primary wide">Войти</button>
        <Link to="/" className="muted small center">
          ← на сайт
        </Link>
      </form>
    </div>
  );
}

function Dashboard({ user, onLogout }: { user: User; onLogout: () => void }) {
  const today = todayIso();
  const [cabins, setCabins] = useState<Cabin[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [filter, setFilter] = useState<BookingStatus | "all">("all");
  const [from, setFrom] = useState(today);
  const [selected, setSelected] = useState<Booking | null>(null);
  const [showManual, setShowManual] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [b, e] = await Promise.all([api.bookings(), api.events()]);
    setBookings(b);
    setEvents(e);
    if (user.role === "owner") setStats(await api.stats());
  }, [user.role]);

  useEffect(() => {
    api.cabins().then(setCabins);
    void load();
    // Заявки из чата и подтверждения из Telegram появляются без перезагрузки
    const timer = setInterval(() => void load(), 15_000);
    return () => clearInterval(timer);
  }, [load]);

  const act = async (b: Booking, action: "confirm" | "decline" | "cancel") => {
    try {
      const updated = await api.act(b.id, action);
      setToast(`${updated.code}: ${STATUS[updated.status]}`);
      setSelected(null);
      await load();
    } catch (err) {
      setToast(err instanceof ApiError ? err.message : "Ошибка");
    }
    setTimeout(() => setToast(null), 3000);
  };

  const pending = bookings.filter((b) => b.status === "pending");
  const visible = bookings.filter((b) => filter === "all" || b.status === filter);

  return (
    <div className="admin">
      <header className="admin-top">
        <Link to="/" className="logo">
          Еловый Двор <span className="muted">· кабинет</span>
        </Link>
        <div className="admin-user">
          <span>
            {user.name} <span className="role">{user.role === "owner" ? "владелец" : "менеджер"}</span>
          </span>
          <button className="btn small" onClick={() => setShowManual(true)}>
            + Бронь по телефону
          </button>
          <button
            className="btn small ghost"
            onClick={async () => {
              await api.logout();
              onLogout();
            }}
          >
            Выйти
          </button>
        </div>
      </header>

      {stats && (
        <section className="kpis">
          <Kpi label="Загрузка на 30 дней" value={`${Math.round(stats.occupancy * 100)}%`} bar={stats.occupancy} />
          <Kpi label="Подтверждённая выручка, 30 дней" value={rub(stats.revenueConfirmed)} />
          <Kpi label="Ждут ответа" value={String(stats.pending)} accent={stats.pending > 0} />
          <Kpi
            label="Заявки за месяц по каналам"
            value={`${stats.bySource.assistant ?? 0} / ${stats.bySource.site ?? 0} / ${stats.bySource.admin ?? 0}`}
            hint="AI-чат / сайт / телефон"
          />
        </section>
      )}

      {pending.length > 0 && (
        <section className="panel pending">
          <h2>Новые заявки</h2>
          {pending.map((b) => (
            <div key={b.id} className="pending-row">
              <div>
                <strong>{b.cabinName}</strong> · {formatDay(b.checkIn)} — {formatDay(b.checkOut)} · {b.guests} гост.
                <div className="muted small">
                  {b.guestName}, {formatPhone(b.phone)} · {SOURCE[b.source]} · {rub(b.total)}
                  {b.comment && ` · «${b.comment}»`}
                </div>
              </div>
              <div className="row-actions">
                <button className="btn small primary" onClick={() => act(b, "confirm")}>
                  Подтвердить
                </button>
                <button className="btn small ghost" onClick={() => act(b, "decline")}>
                  Отклонить
                </button>
              </div>
            </div>
          ))}
        </section>
      )}

      <section className="panel">
        <div className="panel-head">
          <h2>Шахматка</h2>
          <div className="row-actions">
            <button className="icon-btn" onClick={() => setFrom(addDays(from, -7))} aria-label="Неделя назад">
              ‹
            </button>
            <button className="btn small ghost" onClick={() => setFrom(today)}>
              Сегодня
            </button>
            <button className="icon-btn" onClick={() => setFrom(addDays(from, 7))} aria-label="Неделя вперёд">
              ›
            </button>
          </div>
        </div>
        <Occupancy cabins={cabins} bookings={bookings} from={from} onSelect={setSelected} />
        <div className="calendar-legend">
          <span>
            <i className="dot confirmed" /> подтверждена
          </span>
          <span>
            <i className="dot pending" /> ждёт ответа
          </span>
        </div>
      </section>

      <div className="admin-grid">
        <section className="panel">
          <div className="panel-head">
            <h2>Все брони</h2>
            <select value={filter} onChange={(e) => setFilter(e.target.value as BookingStatus | "all")} aria-label="Фильтр по статусу">
              <option value="all">все статусы</option>
              {Object.entries(STATUS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Код</th>
                  <th>Домик</th>
                  <th>Даты</th>
                  <th>Гость</th>
                  <th>Канал</th>
                  <th>Сумма</th>
                  <th>Статус</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((b) => (
                  <tr key={b.id} onClick={() => setSelected(b)}>
                    <td className="mono">{b.code}</td>
                    <td>{b.cabinName}</td>
                    <td>
                      {formatDay(b.checkIn)} — {formatDay(b.checkOut)}
                    </td>
                    <td>{b.guestName}</td>
                    <td>{SOURCE[b.source]}</td>
                    <td>{rub(b.total)}</td>
                    <td>
                      <span className={`status ${b.status}`}>{STATUS[b.status]}</span>
                    </td>
                  </tr>
                ))}
                {visible.length === 0 && (
                  <tr>
                    <td colSpan={7} className="muted center">
                      Броней нет
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel">
          <h2>Журнал</h2>
          <ul className="events">
            {events.map((e) => (
              <li key={e.id}>
                <span className="mono small">{e.bookingCode}</span> {EVENT[e.type] ?? e.type}
                <div className="muted small">
                  {actorLabel(e.actor)} · {new Date(e.createdAt).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {selected && (
        <Modal onClose={() => setSelected(null)}>
          <h2>
            {selected.cabinName} <span className="mono muted">{selected.code}</span>
          </h2>
          <dl className="details">
            <dt>Даты</dt>
            <dd>
              {formatDay(selected.checkIn)} — {formatDay(selected.checkOut)}
            </dd>
            <dt>Гость</dt>
            <dd>
              {selected.guestName}, {selected.guests} чел.
            </dd>
            <dt>Телефон</dt>
            <dd>
              <a href={`tel:${selected.phone}`}>{formatPhone(selected.phone)}</a>
            </dd>
            <dt>Сумма</dt>
            <dd>{rub(selected.total)}</dd>
            <dt>Канал</dt>
            <dd>{SOURCE[selected.source]}</dd>
            <dt>Статус</dt>
            <dd>
              <span className={`status ${selected.status}`}>{STATUS[selected.status]}</span>
            </dd>
            {selected.comment && (
              <>
                <dt>Пожелания</dt>
                <dd>{selected.comment}</dd>
              </>
            )}
          </dl>
          <div className="row-actions">
            {selected.status === "pending" && (
              <>
                <button className="btn primary" onClick={() => act(selected, "confirm")}>
                  Подтвердить
                </button>
                <button className="btn ghost" onClick={() => act(selected, "decline")}>
                  Отклонить
                </button>
              </>
            )}
            {user.role === "owner" && (selected.status === "pending" || selected.status === "confirmed") && (
              <button className="btn danger" onClick={() => confirm("Отменить бронь?") && act(selected, "cancel")}>
                Отменить бронь
              </button>
            )}
          </div>
        </Modal>
      )}

      {showManual && (
        <Modal onClose={() => setShowManual(false)}>
          <ManualBooking
            cabins={cabins}
            onDone={async (b) => {
              setShowManual(false);
              setToast(`Бронь ${b.code} добавлена`);
              setTimeout(() => setToast(null), 3000);
              await load();
            }}
          />
        </Modal>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function Kpi({ label, value, hint, bar, accent }: { label: string; value: string; hint?: string; bar?: number; accent?: boolean }) {
  return (
    <div className={`kpi ${accent ? "accent" : ""}`}>
      <span className="muted small">{label}</span>
      <strong>{value}</strong>
      {hint && <span className="muted small">{hint}</span>}
      {bar !== undefined && (
        <div className="kpi-bar">
          <i style={{ width: `${Math.round(bar * 100)}%` }} />
        </div>
      )}
    </div>
  );
}

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="panel modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <button className="icon-btn modal-close" onClick={onClose} aria-label="Закрыть">
          ×
        </button>
        {children}
      </div>
    </div>
  );
}

function ManualBooking({ cabins, onDone }: { cabins: Cabin[]; onDone: (b: Booking) => void }) {
  const today = todayIso();
  const [form, setForm] = useState({
    cabinId: cabins[0]?.id ?? 1,
    checkIn: addDays(today, 1),
    checkOut: addDays(today, 3),
    guests: 2,
    guestName: "",
    phone: "",
    comment: "",
  });
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      onDone(await api.manualBooking({ ...form, confirm: true }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Ошибка");
    }
  };

  return (
    <form onSubmit={submit} className="manual">
      <h2>Бронь по телефону</h2>
      <p className="muted small">Гость позвонил — внесите бронь, и даты сразу закроются на сайте и в чате.</p>
      <label className="field">
        <span className="label">Домик</span>
        <select value={form.cabinId} onChange={(e) => set({ cabinId: Number(e.target.value) })}>
          {cabins.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} (до {c.capacity})
            </option>
          ))}
        </select>
      </label>
      <div className="two">
        <label className="field">
          <span className="label">Заезд</span>
          <input type="date" min={today} value={form.checkIn} onChange={(e) => set({ checkIn: e.target.value })} />
        </label>
        <label className="field">
          <span className="label">Выезд</span>
          <input type="date" min={form.checkIn} value={form.checkOut} onChange={(e) => set({ checkOut: e.target.value })} />
        </label>
      </div>
      <div className="two">
        <label className="field">
          <span className="label">Гостей</span>
          <input type="number" min={1} max={30} value={form.guests} onChange={(e) => set({ guests: Number(e.target.value) })} />
        </label>
        <label className="field">
          <span className="label">Телефон</span>
          <input required type="tel" value={form.phone} onChange={(e) => set({ phone: e.target.value })} placeholder="+375 29 …" />
        </label>
      </div>
      <label className="field">
        <span className="label">Имя</span>
        <input required value={form.guestName} onChange={(e) => set({ guestName: e.target.value })} />
      </label>
      <label className="field">
        <span className="label">Комментарий</span>
        <input value={form.comment} onChange={(e) => set({ comment: e.target.value })} />
      </label>
      {error && <p className="error">{error}</p>}
      <button className="btn primary wide">Добавить и подтвердить</button>
    </form>
  );
}
