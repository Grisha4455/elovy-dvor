import { addDays, type Booking, type Cabin } from "../api";

const WD = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];

interface Props {
  cabins: Cabin[];
  bookings: Booking[];
  from: string;
  days?: number;
  onSelect: (booking: Booking) => void;
}

/** «Шахматка»: строки — домики, столбцы — ночи, полосы — брони. */
export function Occupancy({ cabins, bookings, from, days = 14, onSelect }: Props) {
  const dates = Array.from({ length: days }, (_, i) => addDays(from, i));
  const to = addDays(from, days);

  return (
    <div className="occupancy" style={{ "--days": days } as React.CSSProperties}>
      <div className="occ-row occ-head">
        <span />
        {dates.map((d) => {
          const wd = new Date(`${d}T00:00:00Z`).getUTCDay();
          return (
            <span key={d} className={wd === 5 || wd === 6 ? "weekend" : ""}>
              <b>{Number(d.slice(8))}</b>
              {WD[wd]}
            </span>
          );
        })}
      </div>
      {cabins.map((cabin) => (
        <div key={cabin.id} className="occ-row">
          <span className="occ-cabin">{cabin.name}</span>
          {dates.map((d) => (
            <span key={d} className="occ-cell" />
          ))}
          {bookings
            .filter((b) => b.cabinId === cabin.id && (b.status === "confirmed" || b.status === "pending") && b.checkOut > from && b.checkIn < to)
            .map((b) => {
              const start = Math.max(0, dates.indexOf(b.checkIn < from ? from : b.checkIn));
              const end = b.checkOut >= to ? days : dates.indexOf(b.checkOut);
              return (
                <button
                  key={b.id}
                  className={`occ-bar ${b.status}`}
                  style={{ gridColumn: `${start + 2} / ${end + 2}` }}
                  onClick={() => onSelect(b)}
                  title={`${b.guestName} · ${b.code}`}
                >
                  {b.guestName}
                </button>
              );
            })}
        </div>
      ))}
    </div>
  );
}
