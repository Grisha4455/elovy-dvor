import { createApp } from "./app.js";
import { AssistantService, claudeCreateMessage } from "./assistant/assistant.js";
import { startScheduler } from "./automation/jobs.js";
import { loadConfig } from "./config.js";
import { openDb, seedCabins } from "./db.js";
import { BookingService } from "./services/bookingService.js";
import { NoopNotifier, type Notifier } from "./services/notifier.js";
import { TelegramApi } from "./telegram/telegramApi.js";
import { TelegramNotifier } from "./telegram/telegramNotifier.js";

const config = loadConfig();
const db = openDb(config.DB_PATH);
seedCabins(db);

const telegram = config.TELEGRAM_BOT_TOKEN ? new TelegramApi(config.TELEGRAM_BOT_TOKEN) : null;
const notifier: Notifier =
  telegram && config.TELEGRAM_CHAT_ID ? new TelegramNotifier(telegram, config.TELEGRAM_CHAT_ID) : new NoopNotifier();

const bookings = new BookingService(db, notifier);
const assistant = config.ANTHROPIC_API_KEY
  ? new AssistantService(db, bookings, claudeCreateMessage(config.ANTHROPIC_API_KEY), config.ASSISTANT_MODEL)
  : null;

const app = createApp({ config, db, bookings, assistant, telegram });
const stopScheduler = startScheduler({ db, bookings, notifier });

const server = app.listen(config.PORT, () => {
  console.log(`API: http://localhost:${config.PORT}`);
  console.log(`AI-администратор: ${assistant ? "включён" : "выключен (нет ANTHROPIC_API_KEY)"}`);
  console.log(`Telegram: ${notifier instanceof TelegramNotifier ? "включён" : "выключен"}`);
});

function shutdown() {
  stopScheduler();
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
