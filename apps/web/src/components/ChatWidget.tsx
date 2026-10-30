import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "../api";

interface Line {
  from: "guest" | "bot";
  text: string;
  bookingCode?: string;
}

const GREETING: Line = {
  from: "bot",
  text: "Здравствуйте! Я администратор «Елового Двора». Подскажу свободные домики, посчитаю стоимость и оформлю бронь. На какие даты планируете?",
};

const SUGGESTIONS = ["Есть что-то на эти выходные для двоих?", "Хотим с собакой на 3 ночи", "Компания 10 человек, нужна баня"];

export function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<Line[]>([GREETING]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const sessionId = useRef<string | undefined>(undefined);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [lines, busy]);

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || busy) return;
    setInput("");
    setLines((l) => [...l, { from: "guest", text: message }]);
    setBusy(true);
    try {
      const res = await api.chat(sessionId.current, message);
      sessionId.current = res.sessionId;
      setLines((l) => [...l, { from: "bot", text: res.reply, bookingCode: res.bookingCode }]);
    } catch (err) {
      if (err instanceof ApiError && err.code === "session_full") sessionId.current = undefined;
      const text = err instanceof ApiError ? err.message : "Нет связи с сервером. Попробуйте ещё раз.";
      setLines((l) => [...l, { from: "bot", text }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button className={`chat-fab ${open ? "hidden" : ""}`} onClick={() => setOpen(true)}>
        <span className="pulse" /> Спросить администратора
      </button>
      {open && (
        <section className="chat" aria-label="Чат с администратором">
          <header>
            <div>
              <strong>Администратор</strong>
              <span className="online">отвечает сразу · AI</span>
            </div>
            <button className="icon-btn" onClick={() => setOpen(false)} aria-label="Закрыть">
              ×
            </button>
          </header>
          <div className="chat-body" ref={scroller}>
            {lines.map((line, i) => (
              <div key={i} className={`bubble ${line.from}`}>
                {line.text}
                {line.bookingCode && <div className="bubble-code">Код брони: {line.bookingCode}</div>}
              </div>
            ))}
            {busy && (
              <div className="bubble bot typing">
                <i />
                <i />
                <i />
              </div>
            )}
            {lines.length === 1 && (
              <div className="suggestions">
                {SUGGESTIONS.map((s) => (
                  <button key={s} onClick={() => send(s)}>
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
          <form
            className="chat-input"
            onSubmit={(e) => {
              e.preventDefault();
              void send(input);
            }}
          >
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Напишите сообщение…" maxLength={1000} aria-label="Сообщение" />
            <button className="btn primary" disabled={busy || !input.trim()}>
              ↑
            </button>
          </form>
        </section>
      )}
    </>
  );
}
