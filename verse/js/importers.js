// Turns Bible files the user owns into the app's format: books[bookIndex][chapter-1][verse-1] = text.
import { BOOKS, findBook } from './books.js';

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

function builder() {
  const books = [];
  let verses = 0;
  return {
    add(b, c, v, text) {
      b = Number(b); c = Number(c); v = Number(v);
      text = clean(text);
      if (!(b >= 0 && b < 66) || !(c >= 1 && c <= 150) || !(v >= 1 && v <= 200) || !text) return;
      const book = (books[b] ||= []);
      const chapter = (book[c - 1] ||= []);
      if (!chapter[v - 1]) verses++;
      chapter[v - 1] = chapter[v - 1] ? `${chapter[v - 1]} ${text}` : text;
    },
    get verses() { return verses; },
    result() {
      // Fill holes so every chapter and verse slot is a real array entry.
      for (let b = 0; b < 66; b++) {
        if (!books[b]) { books[b] = null; continue; }
        for (let c = 0; c < books[b].length; c++) {
          const chapter = books[b][c] || [];
          for (let v = 0; v < chapter.length; v++) chapter[v] ||= '';
          books[b][c] = chapter;
        }
      }
      return books;
    },
  };
}

// A book given as a name, abbreviation, code or 1-66 number.
function bookIndex(value) {
  if (value == null) return -1;
  if (typeof value === 'number' || /^\d+$/.test(String(value).trim())) {
    const n = Number(value);
    return n >= 1 && n <= 66 ? n - 1 : -1;
  }
  return findBook(value, false);
}

/* ---------- JSON ---------- */

const pick = (obj, keys) => { for (const k of keys) if (obj[k] != null) return obj[k]; };
const BOOK_KEYS = ['book', 'book_name', 'bookName', 'book_id', 'bookId', 'b', 'name', 'abbrev', 'abbreviation', 'osis', 'id', 'bnumber', 'number'];
const CHAPTER_KEYS = ['chapter', 'c', 'chapter_id', 'chapterNumber', 'chapter_number'];
const VERSE_KEYS = ['verse', 'v', 'verse_id', 'verseNumber', 'verse_number', 'number'];
const TEXT_KEYS = ['text', 't', 'content', 'scripture', 'verse_text', 'value'];

function jsonBook(out, b, chapters) {
  if (b < 0 || chapters == null) return;
  const eachChapter = Array.isArray(chapters) ? chapters.map((ch, i) => [i + 1, ch]) : Object.entries(chapters);
  for (const [key, ch] of eachChapter) {
    if (ch == null) continue;
    let c = Number(key);
    let verses = ch;
    if (!Array.isArray(ch) && typeof ch === 'object' && (ch.verses || ch.vs)) {
      c = Number(pick(ch, CHAPTER_KEYS) ?? key);
      verses = ch.verses || ch.vs;
    }
    const eachVerse = Array.isArray(verses) ? verses.map((v, i) => [i + 1, v]) : Object.entries(verses);
    for (const [vKey, verse] of eachVerse) {
      if (verse == null) continue;
      if (typeof verse === 'object') out.add(b, c, pick(verse, VERSE_KEYS) ?? vKey, pick(verse, TEXT_KEYS));
      else out.add(b, c, vKey, verse);
    }
  }
}

function parseJson(text, out) {
  let data = JSON.parse(text);
  if (data?.resultset?.row) data = data.resultset.row.map((r) => ({ b: r.field[1], c: r.field[2], v: r.field[3], t: r.field[4] }));
  for (const key of ['books', 'verses', 'data', 'bible', 'rows']) {
    if (data && !Array.isArray(data) && data[key] && typeof data[key] === 'object') { data = data[key]; break; }
  }
  if (Array.isArray(data)) {
    const first = data.find((x) => x && typeof x === 'object');
    if (first && (first.chapters || first.chapter?.length)) {
      // [{name, chapters: [...]}] — fall back to position when the name is unknown.
      const byPosition = data.length === 66 || data.length === 27;
      data.forEach((book, i) => {
        let b = bookIndex(pick(book, ['name', 'book', 'abbrev', 'abbreviation', 'osis', 'id', 'number']));
        if (b < 0 && byPosition) b = data.length === 27 ? i + 39 : i;
        jsonBook(out, b, book.chapters);
      });
    } else {
      // Flat rows, one verse each.
      for (const row of data) {
        if (!row || typeof row !== 'object') continue;
        out.add(bookIndex(pick(row, BOOK_KEYS)), pick(row, CHAPTER_KEYS), pick(row, VERSE_KEYS), pick(row, TEXT_KEYS));
      }
    }
  } else if (data && typeof data === 'object') {
    // {"Genesis": {"1": {"1": "text"}}}
    for (const [name, chapters] of Object.entries(data)) jsonBook(out, bookIndex(name), chapters?.chapters || chapters);
  }
}

/* ---------- XML: Zefania, OSIS, USFX, OpenSong and book/chapter/verse layouts ---------- */

const SKIP_TAGS = new Set(['note', 'title', 'f', 'x', 'fn', 'ref', 'reference', 'rdg', 'catchword', 'h', 'id', 'toc', 'rem', 'ide', 's', 'ms', 'mt', 'd', 'r', 'cl', 'fig', 'header', 'information', 'gram', 'xref', 'caption', 'prolog', 'remark']);

function textOf(node) {
  let s = '';
  for (const child of node.childNodes) {
    if (child.nodeType === 3 || child.nodeType === 4) s += child.nodeValue;
    else if (child.nodeType === 1 && !SKIP_TAGS.has(child.localName.toLowerCase())) s += textOf(child);
  }
  return s;
}

function parseXml(text, out) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('This XML file is damaged or incomplete.');
  const attr = (el, names) => { for (const n of names) if (el.hasAttribute(n)) return el.getAttribute(n); return null; };
  let book = -1, chapter = 0, verse = 0, buffer = '', count = 0;
  const flush = () => { if (verse && buffer.trim()) out.add(book, chapter, verse, buffer); buffer = ''; verse = 0; };

  const walk = (node) => {
    for (const child of node.childNodes) {
      if (child.nodeType === 3 || child.nodeType === 4) { if (verse) buffer += child.nodeValue; continue; }
      if (child.nodeType !== 1) continue;
      const tag = child.localName.toLowerCase();
      if (SKIP_TAGS.has(tag)) continue;
      const osisId = child.getAttribute('osisID');

      if (tag === 'biblebook' || tag === 'book' || (tag === 'b' && child.hasAttribute('n')) || (tag === 'div' && child.getAttribute('type') === 'book')) {
        flush();
        const position = count++;
        book = bookIndex(osisId) >= 0 ? bookIndex(osisId) : -1;
        if (book < 0) for (const n of ['bname', 'bsname', 'name', 'id', 'n', 'code', 'abbr', 'title']) {
          const value = child.getAttribute(n);
          if (value && findBook(value, false) >= 0) { book = findBook(value, false); break; }
        }
        if (book < 0) book = bookIndex(attr(child, ['bnumber', 'number', 'num']));
        if (book < 0) book = position < 66 ? position : -1;
        chapter = 0;
        walk(child); flush();
      } else if (tag === 'chapter' || tag === 'c') {
        flush();
        if (child.hasAttribute('eID')) continue;
        const ref = osisId || child.getAttribute('osisRef') || '';
        const n = attr(child, ['cnumber', 'number', 'n', 'id', 'num']);
        chapter = parseInt(ref ? ref.split('.')[1] : n, 10) || chapter + 1;
        walk(child); flush();
      } else if (tag === 'vers' || tag === 'verse' || tag === 'v') {
        if (child.hasAttribute('eID')) { flush(); continue; }
        flush();
        if (osisId) {
          const [bk, ch, vs] = osisId.split(' ')[0].split('.');
          if (bookIndex(bk) >= 0) book = bookIndex(bk);
          chapter = parseInt(ch, 10) || chapter;
          verse = parseInt(vs, 10) || 0;
        } else {
          verse = parseInt(attr(child, ['vnumber', 'number', 'n', 'id', 'num']), 10) || 0;
        }
        if (child.childNodes.length) { buffer = textOf(child); flush(); }
      } else if (tag === 've') {
        flush();
      } else {
        walk(child);
      }
    }
  };
  walk(doc.documentElement);
  flush();
}

/* ---------- USFM ---------- */

function parseUsfm(text, out) {
  let book = -1, chapter = 0, verse = 0, buffer = '';
  const flush = () => { if (verse) out.add(book, chapter, verse, buffer); buffer = ''; verse = 0; };
  const strip = (s) => s
    .replace(/\\(f|fe|x|ef|ex)\b.*?\\\1\*/gs, '')
    .replace(/\\\+?w\s+([^|\\]*)(\|[^\\]*)?\\\+?w\*/g, '$1')
    .replace(/\\[a-z0-9+]+\*?/gi, ' ')
    .replace(/\|[a-z-]+="[^"]*"/gi, '');
  for (const line of text.split(/\r?\n/)) {
    const marker = line.match(/^\\(\w+)\s*(.*)$/);
    const tag = marker?.[1];
    if (tag === 'id') { flush(); book = findBook(marker[2].trim().split(/\s+/)[0], false); chapter = 0; continue; }
    if (tag === 'c') { flush(); chapter = parseInt(marker[2], 10) || chapter + 1; continue; }
    if (tag && /^(h|toc\d?|mt\d?|ms\d?|mr|s\d?|sr|r|d|sp|ide|rem|cl|cp|sts|usfm|imt\d?|is\d?|ip|ipi|im|io\d?|iot|iex|ie|restore)$/.test(tag)) continue;
    let rest = line;
    const parts = rest.split(/\\v\s+(\d+)[a-z]?(?:[-,]\d+)?\s*/);
    // parts: [before, num, text, num, text...]
    if (verse && parts[0].trim()) buffer += ' ' + strip(parts[0]);
    for (let i = 1; i < parts.length; i += 2) {
      flush();
      verse = parseInt(parts[i], 10);
      buffer = strip(parts[i + 1] || '');
    }
  }
  flush();
}

/* ---------- Plain text: one verse per line ---------- */

const stripInline = (s) => s
  .replace(/<(RF|TS\d?|Rf)[^>]*>.*?<(Rf|Ts)>/g, '')
  .replace(/<W[GH]\d+[^>]*>/g, '')
  .replace(/<[^>]{1,40}>/g, ' ')
  .replace(/\{[^}]{0,400}\}/g, ' ');

function parseLines(text, out) {
  const named = /^\s*((?:[1-3]|I{1,3})?\s*[A-Za-z][A-Za-z. ]*?)\.?\s+(\d+)\s*[:.]\s*(\d+)\s*[\t|:.-]?\s*(.+)$/;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cols = line.split(/\t|\|\|?/);
    if (cols.length >= 4 && /^\d+$/.test(cols[1].trim()) && /^\d+$/.test(cols[2].trim())) {
      out.add(bookIndex(cols[0].trim()), cols[1], cols[2], stripInline(cols.slice(3).join(' ')));
      continue;
    }
    const csv = line.match(/^\s*"?([^",]+)"?\s*,\s*"?(\d+)"?\s*,\s*"?(\d+)"?\s*,\s*"?(.*?)"?\s*$/);
    if (csv) { out.add(bookIndex(csv[1].trim()), csv[2], csv[3], stripInline(csv[4].replace(/""/g, '"'))); continue; }
    const m = line.match(named);
    if (m) out.add(findBook(m[1], false), m[2], m[3], stripInline(m[4]));
  }
}

// theWord modules list every verse on its own line in canonical order (.ont, .ot, .nt).
function parseOrdered(text, out, shape) {
  const lines = text.split(/\r?\n/);
  const total = (from, to) => shape.slice(from, to).reduce((sum, book) => sum + book.reduce((a, n) => a + n, 0), 0);
  let from = 0, to = 66;
  const nonEmpty = lines.findIndex((l, i) => i >= total(39, 66) && !l.trim());
  const length = lines.length;
  if (length >= total(0, 66)) { from = 0; to = 66; }
  else if (length >= total(0, 39) && (nonEmpty < 0 || nonEmpty >= total(0, 39))) { from = 0; to = 39; }
  else if (length >= total(39, 66)) { from = 39; to = 66; }
  else return;
  let i = 0;
  for (let b = from; b < to; b++) shape[b].forEach((count, c) => {
    for (let v = 1; v <= count; v++) out.add(b, c + 1, v, stripInline(lines[i++] || ''));
  });
}

/* ---------- Entry point ---------- */

// files: FileList or array. shape: verse counts per chapter of the built-in Bible (for ordered text files).
export async function importFiles(files, shape) {
  const out = builder();
  const problems = [];
  for (const file of files) {
    const name = file.name.toLowerCase();
    const before = out.verses;
    try {
      const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
      const magic = String.fromCharCode(...head);
      if (magic.startsWith('SQLite format') || magic.startsWith('PK')) {
        problems.push(`${file.name}: database and zip files (MyBible, e-Sword, .zip) can't be read. Export it as XML, JSON, USFM or text first.`);
        continue;
      }
      const text = (await file.text()).replace(/^﻿/, '');
      const start = text.trimStart().slice(0, 300);
      if (/\.(ont|ot|nt)$/.test(name)) parseOrdered(text, out, shape);
      else if (start.startsWith('<')) parseXml(text, out);
      else if (start.startsWith('{') || start.startsWith('[')) parseJson(text, out);
      else if (/\\id\s+\w{3}/.test(text.slice(0, 2000)) || /\\c\s+\d+[\s\S]{0,200}\\v\s+\d+/.test(text.slice(0, 20000))) parseUsfm(text, out);
      else {
        parseLines(text, out);
        if (out.verses === before && text.split(/\r?\n/).length >= 7950) parseOrdered(text, out, shape);
      }
      if (out.verses === before) problems.push(`${file.name}: no verses were recognised in this file.`);
    } catch (error) {
      problems.push(`${file.name}: ${error.message || 'could not be read.'}`);
    }
  }
  const books = out.result();
  return { books, verses: out.verses, bookCount: books.filter(Boolean).length, problems };
}

export const bookNames = (books) => books.map((b, i) => (b ? BOOKS[i].name : null)).filter(Boolean);
