// Этапы 1-5.
// Бот по книге/странице/строке выдаёт строку с достройкой оборванных слов
// и сносками (для «Войны и мира»).
 
import "dotenv/config";
import { Bot, session, InlineKeyboard } from "grammy";
import { readFile } from "fs/promises";
 
// --- Токен ---
const token = process.env.BOT_TOKEN;
if (!token) {
  console.error("Не найден BOT_TOKEN. Проверь файл .env.");
  process.exit(1);
}
 
// --- Список книг ---
const BOOKS = [
  { id: "crime", title: "Преступление и наказание", file: "./crime.json" },
  { id: "gogol", title: "Мёртвые души", file: "./gogol.json" },
  { id: "war", title: "Война и мир", file: "./war.json" },
];
 
// --- Загрузка книг в память ---
// Каждая страница в JSON: { lines: [...], footnotes: { "1": "...", ... } }
const library = {}; // id -> { title, pages, flat, pageInfo, maxPage }
for (const b of BOOKS) {
  const pages = JSON.parse(await readFile(b.file, "utf-8"));
  const flat = []; // [{ page, text }, ...] — все строки книги подряд
  const pageInfo = {}; // page -> { start, count }
  const pageNums = Object.keys(pages).map(Number).sort((a, c) => a - c);
  for (const pn of pageNums) {
    const lines = pages[String(pn)].lines;
    pageInfo[pn] = { start: flat.length, count: lines.length };
    for (const text of lines) flat.push({ page: pn, text });
  }
  library[b.id] = {
    title: b.title,
    pages,
    flat,
    pageInfo,
    maxPage: pageNums[pageNums.length - 1],
  };
  console.log(`Загружена книга "${b.title}" — ${pageNums.length} страниц.`);
}
 
// --- Надстрочные цифры (для сносок) ---
const SUP = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴",
              "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹" };
const SUP_BACK = Object.fromEntries(Object.entries(SUP).map(([d, s]) => [s, d]));
const toSuper = (s) => String(s).split("").map((c) => SUP[c] || c).join("");
 
// Находит номера сносок (надстрочные цифры) в тексте строки.
function findFootnoteRefs(text) {
  const refs = [];
  const re = /[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g;
  let m;
  while ((m = re.exec(text))) {
    refs.push(m[0].split("").map((c) => SUP_BACK[c]).join(""));
  }
  return [...new Set(refs)];
}
 
// --- Достройка оборванных слов ---
// Слова, после которых дефис при переносе НАДО сохранить (что-то, какой-нибудь, по-русски).
const KEEP_SUFFIX = new Set(["то", "либо", "нибудь", "ка", "таки", "с"]);
const KEEP_PREFIX = new Set(["кое", "по", "из", "во", "экс", "пол"]);
 
// Возвращает текст строки idx с достроенными оборванными словами на концах.
function completeLine(flat, idx) {
  let text = flat[idx].text;
 
  // НАЧАЛО: достраиваем оборванное первое слово
  if (idx > 0 && flat[idx - 1].text.endsWith("-")) {
    const prev = flat[idx - 1].text;
    const frag = prev.slice(prev.lastIndexOf(" ") + 1);
    const base = frag.slice(0, -1);
    const lw = (base.match(/[А-Яа-яЁё]+$/) || [""])[0].toLowerCase();
    const fw = (text.match(/^[А-Яа-яЁё]+/) || [""])[0].toLowerCase();
    const keepHyphen = KEEP_SUFFIX.has(fw) || KEEP_PREFIX.has(lw);
    text = base + (keepHyphen ? "-" : "") + text;
  }
 
  // КОНЕЦ: достраиваем оборванное последнее слово
  if (text.endsWith("-") && idx < flat.length - 1) {
    const next = flat[idx + 1].text;
    const frag = next.slice(0, next.search(/\s|$/));
    const base = text.slice(0, -1);
    const lw = (base.match(/[А-Яа-яЁё]+$/) || [""])[0].toLowerCase();
    const fw = (frag.match(/^[А-Яа-яЁё]+/) || [""])[0].toLowerCase();
    const keepHyphen = KEEP_SUFFIX.has(fw) || KEEP_PREFIX.has(lw);
    text = base + (keepHyphen ? "-" : "") + frag;
  }
 
  return text.trim();
}
 
// --- Достаём строку. Возвращает { ok, text, footnotes } или { ok:false, error } ---
function getLine(book, page, line, direction) {
  const info = book.pageInfo[page];
  if (!info) {
    return { ok: false, error: `В книге нет страницы ${page}. Доступны страницы 1–${book.maxPage}.` };
  }
  if (info.count === 0) {
    return { ok: false, error: `На странице ${page} нет текста.` };
  }
  const idxOnPage = direction === "top" ? line - 1 : info.count - line;
  if (idxOnPage < 0 || idxOnPage >= info.count) {
    return { ok: false, error: `На странице ${page} всего ${info.count} строк(и).` };
  }
  const text = completeLine(book.flat, info.start + idxOnPage);
 
  // сноски, на которые ссылается строка
  const pageFootnotes = book.pages[String(page)].footnotes || {};
  const footnotes = findFootnoteRefs(text)
    .filter((n) => pageFootnotes[n])
    .map((n) => ({ num: n, text: pageFootnotes[n] }));
 
  return { ok: true, text, footnotes };
}
 
const bot = new Bot(token);
 
// --- Состояние диалога ---
function initialSession() {
  return { step: "idle", bookId: null, page: null, line: null, direction: null };
}
bot.use(session({ initial: initialSession }));
 
// --- Клавиатуры ---
function booksKeyboard() {
  const kb = new InlineKeyboard();
  for (const b of BOOKS) kb.text(b.title, `book:${b.id}`).row();
  return kb;
}
function directionKeyboard() {
  return new InlineKeyboard()
    .text("⬆️ Сверху", "dir:top")
    .text("⬇️ Снизу", "dir:bottom");
}
 
// --- /start ---
bot.command("start", async (ctx) => {
  ctx.session = initialSession();
  await ctx.reply("Привет! Я помогу найти строку в книге.\n\nВыбери книгу:", {
    reply_markup: booksKeyboard(),
  });
});
 
// --- Выбор книги ---
bot.callbackQuery(/^book:(.+)$/, async (ctx) => {
  const bookId = ctx.match[1];
  const book = BOOKS.find((b) => b.id === bookId);
  if (!book) {
    await ctx.answerCallbackQuery("Книга не найдена");
    return;
  }
  ctx.session.bookId = bookId;
  ctx.session.step = "awaiting_page";
  await ctx.answerCallbackQuery();
  await ctx.reply(
    `Книга: ${book.title}\n\n` +
      "Введи номер страницы.\n" +
      "Можно сразу и строку через пробел — например: 50 3"
  );
});
 
// --- Выбор направления + выдача строки ---
bot.callbackQuery(/^dir:(top|bottom)$/, async (ctx) => {
  if (ctx.session.step !== "awaiting_direction") {
    await ctx.answerCallbackQuery("Сначала нажми /start");
    return;
  }
  ctx.session.direction = ctx.match[1];
  ctx.session.step = "done";
  await ctx.answerCallbackQuery();
 
  const book = library[ctx.session.bookId];
  const { page, line, direction } = ctx.session;
  const result = getLine(book, page, line, direction);
 
  if (!result.ok) {
    await ctx.reply(`⚠️ ${result.error}\n\nПопробуй снова — /start`);
    return;
  }
 
  const dirText = direction === "top" ? "сверху" : "снизу";
  let msg =
    `📖 ${book.title}\n📄 Страница ${page}, строка ${line} (${dirText}):\n\n` +
    `«${result.text}»`;
  if (result.footnotes.length) {
    msg += "\n";
    for (const f of result.footnotes) {
      msg += `\n${toSuper(f.num)} ${f.text}`;
    }
  }
  msg += `\n\nЕщё раз — /start`;
  await ctx.reply(msg);
});
 
// --- Текстовые сообщения ---
bot.on("message:text", async (ctx) => {
  const step = ctx.session.step;
  const text = ctx.message.text.trim();
 
  if (step === "awaiting_page") {
    const nums = text.match(/\d+/g);
    if (!nums) {
      await ctx.reply("Нужно число. Введи номер страницы (можно сразу и строку: «50 3»):");
      return;
    }
    if (nums.length > 2) {
      await ctx.reply("Слишком много чисел. Введи страницу или страницу и строку: «50 3»");
      return;
    }
    const page = Number(nums[0]);
    const book = library[ctx.session.bookId];
    const info = book.pageInfo[page];
    if (!info) {
      await ctx.reply(`В книге нет страницы ${page}. Доступны страницы 1–${book.maxPage}. Введи ещё раз:`);
      return;
    }
    if (info.count === 0) {
      await ctx.reply(`На странице ${page} нет текста. Выбери другую страницу:`);
      return;
    }
    ctx.session.page = page;
 
    // если ввели сразу и строку
    if (nums.length === 2) {
      const line = Number(nums[1]);
      if (line < 1 || line > info.count) {
        ctx.session.step = "awaiting_line";
        await ctx.reply(`На странице ${page} — ${info.count} строк(и), строки ${line} нет. Введи номер строки:`);
        return;
      }
      ctx.session.line = line;
      ctx.session.step = "awaiting_direction";
      await ctx.reply("Как отсчитывать строку?", { reply_markup: directionKeyboard() });
      return;
    }
 
    // ввели только страницу
    ctx.session.step = "awaiting_line";
    await ctx.reply(`На странице ${page} — ${info.count} строк(и). Введи номер строки:`);
    return;
  }
 
  if (step === "awaiting_line") {
    const line = Number(text);
    if (!Number.isInteger(line) || line < 1) {
      await ctx.reply("Нужно целое число больше 0. Попробуй ещё раз:");
      return;
    }
    const info = library[ctx.session.bookId].pageInfo[ctx.session.page];
    if (line > info.count) {
      await ctx.reply(`На странице ${ctx.session.page} всего ${info.count} строк(и). Введи номер строки ещё раз:`);
      return;
    }
    ctx.session.line = line;
    ctx.session.step = "awaiting_direction";
    await ctx.reply("Как отсчитывать строку?", { reply_markup: directionKeyboard() });
    return;
  }
 
  if (step === "awaiting_direction") {
    await ctx.reply("Выбери направление кнопкой:", { reply_markup: directionKeyboard() });
    return;
  }
 
  await ctx.reply("Чтобы начать, нажми /start");
});
 
// --- Обработка ошибок ---
bot.catch((err) => {
  console.error("Ошибка бота:", err);
});
 
bot.start();
console.log("Бот запущен. Останови — Ctrl+C.");
 