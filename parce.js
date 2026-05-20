// Этап 2 — разбор PDF в индекс.
// Запускается ОТДЕЛЬНО и один раз: node parse.js
// Читает PDF и создаёт book.json — { "номер_страницы": ["строка1", "строка2", ...] }
// Бот потом просто читает готовый book.json, сам PDF ему не нужен.
 
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { readFile, writeFile } from "fs/promises";
 
// --- Настройки: путь к PDF и куда сохранить индекс ---
const PDF_PATH = "./Dostoevskyi_Prestuplenie_i_nakazanie.pdf";
const OUT_PATH = "./book.json";
 
// --- Служебные строки (шапка/подвал), которые надо выкинуть ---
// Если возьмёшь другую книгу — эти правила нужно будет подстроить.
function isServiceLine(line) {
  return (
    /Преступление и наказание/.test(line) || // шапка с названием книги
    /100bestbooks\.ru/.test(line) ||         // подвал с адресом сайта
    /^100 лучших книг/.test(line)
  );
}
 
// --- Превращаем кусочки текста PDF в массив строк ---
// У каждого кусочка есть координаты. Группируем по Y (это строка),
// внутри строки сортируем по X (порядок слов слева направо).
function pageToLines(items) {
  const rows = [];
  for (const it of items) {
    if (!it.str.trim()) continue;
    const y = Math.round(it.transform[5]); // координата Y
    let row = rows.find((r) => Math.abs(r.y - y) < 4);
    if (!row) {
      row = { y, parts: [] };
      rows.push(row);
    }
    row.parts.push({ x: it.transform[4], str: it.str });
  }
  rows.sort((a, b) => b.y - a.y); // строки сверху вниз
  return rows
    .map((r) =>
      r.parts
        .sort((a, b) => a.x - b.x)
        .map((p) => p.str)
        .join("")
        .trim()
    )
    .filter(Boolean)
    .filter((line) => !isServiceLine(line)); // убираем шапку и подвал
}
 
// --- Основной процесс ---
const data = new Uint8Array(await readFile(PDF_PATH));
const doc = await getDocument({ data }).promise;
 
const book = {};
for (let p = 1; p <= doc.numPages; p++) {
  const page = await doc.getPage(p);
  book[p] = pageToLines((await page.getTextContent()).items);
  if (p % 50 === 0) console.log(`Обработано страниц: ${p}/${doc.numPages}`);
}
 
await writeFile(OUT_PATH, JSON.stringify(book));
console.log(`Готово: ${doc.numPages} страниц сохранено в ${OUT_PATH}`);