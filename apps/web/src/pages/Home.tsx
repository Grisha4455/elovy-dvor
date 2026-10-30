import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { api, plural, rub, type Cabin } from "../api";
import { BookingPanel } from "../components/BookingPanel";
import { CabinArt } from "../components/CabinArt";
import { ChatWidget } from "../components/ChatWidget";

export function Home() {
  const [cabins, setCabins] = useState<Cabin[]>([]);
  const [cabinId, setCabinId] = useState<number | null>(null);
  const [error, setError] = useState(false);
  const bookingRef = useRef<HTMLElement>(null);

  useEffect(() => {
    api
      .cabins()
      .then((list) => {
        setCabins(list);
        setCabinId(list[0]?.id ?? null);
      })
      .catch(() => setError(true));
  }, []);

  const choose = (id: number) => {
    setCabinId(id);
    bookingRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <div className="site">
      <header className="topbar">
        <a href="#" className="logo">
          <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true">
            <path d="M16 3l8 11h-4.5l5.5 8h-6.5v6h-5v-6H7l5.5-8H8z" fill="currentColor" />
          </svg>
          Еловый Двор
        </a>
        <nav>
          <a href="#cabins">Домики</a>
          <a href="#booking">Бронирование</a>
          <a href="#how">Как это работает</a>
          <Link to="/admin" className="admin-link">
            Вход для владельца
          </Link>
        </nav>
      </header>

      <section className="hero">
        <div className="hero-text">
          <p className="eyebrow">Агроусадьба · 40 минут от Минска</p>
          <h1>
            Домики в ельнике, <em>где слышно тишину</em>
          </h1>
          <p className="lead">Четыре дома на 2–12 гостей, баня на дровах, пруд с причалом. Свободные даты видно сразу, а администратор отвечает в чате круглосуточно.</p>
          <div className="hero-actions">
            <a href="#booking" className="btn primary">
              Выбрать даты
            </a>
            <a href="#cabins" className="btn ghost">
              Смотреть домики
            </a>
          </div>
        </div>
        <CabinArt slug="medvezhiy-ugol" className="hero-art" />
      </section>

      <section id="cabins" className="section">
        <h2>Домики</h2>
        {error && <p className="error">Не удалось загрузить домики. Запущен ли API?</p>}
        <div className="cabins">
          {cabins.map((c) => (
            <article key={c.id} className="cabin-card">
              <CabinArt slug={c.slug} className="cabin-art" />
              <div className="cabin-body">
                <h3>{c.name}</h3>
                <p className="tagline">{c.tagline}</p>
                <p className="muted small">{c.description}</p>
                <ul className="chips">
                  <li>до {c.capacity} {plural(c.capacity, "гостя", "гостей", "гостей")}</li>
                  {c.minNights > 1 && <li>от {c.minNights} ночей</li>}
                  {c.amenities.slice(0, 3).map((a) => (
                    <li key={a}>{a}</li>
                  ))}
                </ul>
                <div className="cabin-foot">
                  <span>
                    от <strong>{rub(c.basePrice)}</strong> / ночь
                  </span>
                  <button className="btn small" onClick={() => choose(c.id)}>
                    Даты
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section id="booking" className="section" ref={bookingRef}>
        <h2>Бронирование</h2>
        <p className="muted">Серые дни заняты. Стоимость считается сразу, с учётом выходных и праздников.</p>
        {cabins.length > 0 && cabinId !== null && <BookingPanel cabins={cabins} cabinId={cabinId} onCabinChange={setCabinId} />}
      </section>

      <section id="how" className="section how">
        <h2>Как это работает</h2>
        <ol className="steps">
          <li>
            <strong>Гость выбирает даты</strong>
            <span>на сайте или пишет AI-администратору в чат обычным текстом, например «на выходные вдвоём».</span>
          </li>
          <li>
            <strong>Даты сразу блокируются</strong>
            <span>и никто другой не сможет занять их, пока владелец не ответит.</span>
          </li>
          <li>
            <strong>Владелец получает заявку в Telegram</strong>
            <span>и подтверждает её одной кнопкой. Если ответа нет 24 часа, даты освобождаются автоматически.</span>
          </li>
          <li>
            <strong>Накануне заезда приходит напоминание</strong>
            <span>какие домики подготовить, а каждое утро — сводка дня.</span>
          </li>
        </ol>
      </section>

      <footer className="footer">
        <span>© «Еловый Двор» — демонстрационный проект, усадьба вымышленная</span>
        <span>Заезд с 14:00 · выезд до 12:00</span>
      </footer>

      <ChatWidget />
    </div>
  );
}
