// Регистрирует webhook у Telegram: npm run telegram:webhook -- https://ваш-домен
import { loadConfig } from "../src/config.js";
import { TelegramApi } from "../src/telegram/telegramApi.js";

const config = loadConfig();
const baseUrl = process.argv[2];
if (!baseUrl?.startsWith("https://")) {
  console.error("Укажите публичный https-адрес сервера: npm run telegram:webhook -- https://example.by");
  process.exit(1);
}
if (!config.TELEGRAM_BOT_TOKEN || !config.TELEGRAM_WEBHOOK_SECRET) {
  console.error("Нужны TELEGRAM_BOT_TOKEN и TELEGRAM_WEBHOOK_SECRET в .env");
  process.exit(1);
}

const api = new TelegramApi(config.TELEGRAM_BOT_TOKEN);
await api.call("setWebhook", {
  url: `${baseUrl.replace(/\/$/, "")}/api/telegram/webhook`,
  secret_token: config.TELEGRAM_WEBHOOK_SECRET,
  allowed_updates: ["message", "callback_query"],
});
await api.call("setMyCommands", {
  commands: [
    { command: "today", description: "Сводка на сегодня" },
    { command: "pending", description: "Заявки без ответа" },
  ],
});
console.log("Webhook зарегистрирован. Нажатия кнопок в Telegram теперь обрабатываются сервером.");
