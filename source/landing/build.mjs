import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import QRCode from "qrcode";

// Ссылка и QR берутся из одного источника; окружение и секреты не читаются.
const botUrl = "https://t.me/munar_tau_user_bot";
// Бот сотрудников в футере: ссылка дважды пропадала из продакшена — жила только
// в рабочей копии или на боковой ветке, а Pages собирает лендинг из закоммиченного
// main. Проверка ниже роняет сборку, если обязательных ссылок снова нет.
const workerBotUrl = "https://t.me/munar_tau_worker_bot";
const requiredLinks = [botUrl, workerBotUrl];
const root = new URL("./", import.meta.url);
const dist = new URL("dist/", root);
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await cp(new URL("public/", root), dist, { recursive: true });
await cp(new URL("styles.css", root), new URL("styles.css", dist));
const html = await readFile(new URL("index.html", root), "utf8");
const built = html.replaceAll("{{BOT_URL}}", botUrl);
await writeFile(new URL("index.html", dist), built);
for (const link of requiredLinks) {
  if (!built.includes(link)) {
    throw new Error(`В собранном лендинге нет обязательной ссылки ${link} — проверьте футер index.html`);
  }
}
await writeFile(new URL("telegram-qr.svg", dist), await QRCode.toString(botUrl, {
  type: "svg", errorCorrectionLevel: "M", margin: 4,
  color: { dark: "#244c43", light: "#ffffff" },
}));
console.log("Лендинг собран: landing/dist");
