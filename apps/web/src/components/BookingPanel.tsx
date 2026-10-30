import { useEffect, useMemo, useState } from "react";
import { addDays, api, ApiError, formatDay, plural, rub, todayIso, type Cabin, type Quote } from "../api";
import { Calendar, type Range } from "./Calendar";

interface Props {
  cabins: Cabin[];
  cabinId: number;
  onCabinChange: (id: number) => void;
}

const TAG_LABEL = { weekend: "выходной", holiday: "праздник" } as const;

export function BookingPanel({ cabins, cabinId, onCabinChange }: Props) {
  const today = todayIso();
  const cabin = cabins.find((c) => c.id === cabinId)!;
  // В последнюю неделю месяца сразу показываем следующий — в текущем почти нечего выбрать
  const [month, setMonth] = useState(() => (Number(today.slice(8)) > 24 ? addDays(today, 8).slice(0, 7) : today.slice(0, 7)));
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [range, setRange] = useState<Range>({ checkIn: null, checkOut: null });
  const [guests, setGuests] = useState(2);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [form, setForm] = useState({ guestName: "", phone: "", comment: "", website: "" });
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ code: string; total: number } | null>(null);

  // Занятые ночи копим по всем просмотренным месяцам, чтобы диапазон на стыке месяцев проверялся целиком
  useEffect(() => {
    let cancelled = false;
    api
      .busyNights(cabinId, month)
      .then((list) => !cancelled && setBusy((prev) => new Set([...prev, ...list])))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [cabinId, month, done]);

  useEffect(() => {
    setBusy(new Set());
    setRange({ checkIn: null, checkOut: null });
    setGuests((g) => Math.min(g, cabin.capacity));
  }, [cabinId, cabin.capacity]);

  useEffect(() => {
    setQuote(null);
    setQuoteError(null);
    if (!range.checkIn || !range.checkOut) return;
    let cancelled = false;
    api
      .quote({ cabinId, checkIn: range.checkIn, checkOut: range.checkOut, guests })
      .then((q) => !cancelled && setQuote(q))
      .catch((e: ApiError) => !cancelled && setQuoteError(e.message));
    return () => {
      cancelled = true;
    };
  }, [cabinId, range.checkIn, range.checkOut, guests]);

  const weekendNights = useMemo(() => quote?.breakdown.filter((n) => n.tag).length ?? 0, [quote]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!range.checkIn || !range.checkOut) return;
    setSending(true);
    setError(null);
    try {
      const res = await api.book({ cabinId, checkIn: range.checkIn, checkOut: range.checkOut, guests, ...form });
      setDone(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось отправить заявку");
    } finally {
      setSending(false);
    }
  };

  if (done) {
    return (
      <div className="panel success">
        <div className="success-mark">✓</div>
        <h3>Заявка отправлена</h3>
        <p>
          Код брони <strong className="code">{done.code}</strong>. Владелец уже получил уведомление в Telegram и перезвонит вам в течение дня, чтобы подтвердить
          бронь.
        </p>
        <p className="muted">Сумма к оплате на месте: {rub(done.total)}</p>
        <button
          className="btn ghost"
          onClick={() => {
            setDone(null);
            setRange({ checkIn: null, checkOut: null });
            setForm({ guestName: "", phone: "", comment: "", website: "" });
          }}
        >
          Новая заявка
        </button>
      </div>
    );
  }

  return (
    <form className="panel booking" onSubmit={submit}>
      <div className="cabin-tabs" role="tablist">
        {cabins.map((c) => (
          <button key={c.id} type="button" role="tab" aria-selected={c.id === cabinId} className={c.id === cabinId ? "tab active" : "tab"} onClick={() => onCabinChange(c.id)}>
            {c.name}
          </button>
        ))}
      </div>

      <div className="booking-grid">
        <Calendar month={month} busy={busy} today={today} range={range} onMonthChange={setMonth} onChange={setRange} />

        <div className="booking-side">
          <div className="field">
            <span className="label">Гостей</span>
            <div className="stepper">
              <button type="button" onClick={() => setGuests((g) => Math.max(1, g - 1))} disabled={guests <= 1} aria-label="Меньше">
                −
              </button>
              <strong>{guests}</strong>
              <button type="button" onClick={() => setGuests((g) => Math.min(cabin.capacity, g + 1))} disabled={guests >= cabin.capacity} aria-label="Больше">
                +
              </button>
              <span className="muted">до {cabin.capacity}</span>
            </div>
          </div>

          <div className="quote">
            {!range.checkIn && <p className="muted">Выберите дату заезда в календаре</p>}
            {range.checkIn && !range.checkOut && <p className="muted">Заезд {formatDay(range.checkIn)} — теперь выберите дату выезда</p>}
            {quoteError && <p className="error">{quoteError}</p>}
            {quote && range.checkIn && range.checkOut && (
              <>
                <p className="quote-dates">
                  {formatDay(range.checkIn)} — {formatDay(range.checkOut)}, {quote.nights} {plural(quote.nights, "ночь", "ночи", "ночей")}
                </p>
                <ul className="quote-lines">
                  {quote.breakdown.map((n) => (
                    <li key={n.date}>
                      <span>
                        {formatDay(n.date)} {n.tag && <em className={`tag ${n.tag}`}>{TAG_LABEL[n.tag]}</em>}
                      </span>
                      <span>{rub(n.price)}</span>
                    </li>
                  ))}
                  {quote.discount > 0 && (
                    <li className="discount">
                      <span>Скидка 10% от 7 ночей</span>
                      <span>−{rub(quote.discount)}</span>
                    </li>
                  )}
                </ul>
                <p className="quote-total">
                  Итого <strong>{rub(quote.total)}</strong>
                </p>
                {weekendNights > 0 && <p className="hint">Ночи пт–сб, сб–вс и праздники дороже на 20–30%</p>}
                {!quote.available && <p className="error">Эти даты только что заняли — выберите другие</p>}
              </>
            )}
          </div>

          {quote?.available && (
            <div className="contact">
              <label className="field">
                <span className="label">Имя</span>
                <input required minLength={2} maxLength={80} value={form.guestName} onChange={(e) => setForm({ ...form, guestName: e.target.value })} autoComplete="name" />
              </label>
              <label className="field">
                <span className="label">Телефон</span>
                <input required type="tel" placeholder="+375 29 123-45-67" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} autoComplete="tel" />
              </label>
              <label className="field">
                <span className="label">Пожелания</span>
                <textarea rows={2} maxLength={500} value={form.comment} onChange={(e) => setForm({ ...form, comment: e.target.value })} placeholder="Поздний заезд, детская кроватка…" />
              </label>
              {/* Поле-ловушка для ботов, скрыто от людей */}
              <input className="hp" tabIndex={-1} autoComplete="off" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} aria-hidden="true" />
              {error && <p className="error">{error}</p>}
              <button className="btn primary wide" disabled={sending}>
                {sending ? "Отправляем…" : `Забронировать за ${rub(quote.total)}`}
              </button>
              <p className="hint">Без предоплаты. Оплата на месте при заезде.</p>
            </div>
          )}
        </div>
      </div>
    </form>
  );
}
