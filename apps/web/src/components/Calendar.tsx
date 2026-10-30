import { addDays } from "../api";

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];

export interface Range {
  checkIn: string | null;
  checkOut: string | null;
}

interface Props {
  month: string; // YYYY-MM
  busy: Set<string>;
  today: string;
  range: Range;
  onMonthChange: (month: string) => void;
  onChange: (range: Range) => void;
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

/** Есть ли занятые ночи в интервале [from, to) */
function crossesBusy(from: string, to: string, busy: Set<string>): boolean {
  for (let d = from; d < to; d = addDays(d, 1)) if (busy.has(d)) return true;
  return false;
}

export function Calendar({ month, busy, today, range, onMonthChange, onChange }: Props) {
  const first = `${month}-01`;
  const offset = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).getUTCDate();
  const cells: (string | null)[] = [
    ...Array<null>(offset).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => addDays(first, i)),
  ];

  const pick = (date: string) => {
    const { checkIn, checkOut } = range;
    // Второй клик после заезда — выбор выезда, если между ними нет занятых ночей
    if (checkIn && !checkOut && date > checkIn && !crossesBusy(checkIn, date, busy)) {
      onChange({ checkIn, checkOut: date });
    } else if (!busy.has(date)) {
      onChange({ checkIn: date, checkOut: null });
    }
  };

  const canGoBack = month > today.slice(0, 7);

  return (
    <div className="calendar">
      <div className="calendar-head">
        <button type="button" className="icon-btn" disabled={!canGoBack} onClick={() => onMonthChange(shiftMonth(month, -1))} aria-label="Предыдущий месяц">
          ‹
        </button>
        <strong>
          {MONTHS[Number(month.slice(5)) - 1]} {month.slice(0, 4)}
        </strong>
        <button type="button" className="icon-btn" onClick={() => onMonthChange(shiftMonth(month, 1))} aria-label="Следующий месяц">
          ›
        </button>
      </div>
      <div className="calendar-grid">
        {WEEKDAYS.map((w) => (
          <span key={w} className="calendar-wd">
            {w}
          </span>
        ))}
        {cells.map((date, i) => {
          if (!date) return <span key={`e${i}`} />;
          const past = date < today;
          const isBusy = busy.has(date);
          const { checkIn, checkOut } = range;
          const selected = date === checkIn || date === checkOut;
          const inRange = checkIn && checkOut && date > checkIn && date < checkOut;
          // День выезда может совпадать с днём заезда следующих гостей
          const checkoutCandidate = checkIn && !checkOut && date > checkIn && !crossesBusy(checkIn, date, busy);
          const disabled = past || (isBusy && !checkoutCandidate);
          const cls = ["day", isBusy && "busy", selected && "selected", inRange && "in-range", past && "past"].filter(Boolean).join(" ");
          return (
            <button key={date} type="button" className={cls} disabled={disabled} onClick={() => pick(date)}>
              {Number(date.slice(8))}
            </button>
          );
        })}
      </div>
      <div className="calendar-legend">
        <span>
          <i className="dot free" /> свободно
        </span>
        <span>
          <i className="dot busy" /> занято
        </span>
        <span>
          <i className="dot sel" /> ваши даты
        </span>
      </div>
    </div>
  );
}
