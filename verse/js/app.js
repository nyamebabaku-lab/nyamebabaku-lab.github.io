import { BOOKS, parseReference, formatReference } from './books.js';
import { importFiles } from './importers.js';

const OUTPUT_MODE = new URLSearchParams(location.search).has('output');
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const plural = (n) => `${n.toLocaleString()} ${n === 1 ? 'verse' : 'verses'}`;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/* ---------- Storage ---------- */

const db = (() => {
  let opening;
  const open = () => (opening ||= new Promise((resolve, reject) => {
    const request = indexedDB.open('versebeam', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('bibles', { keyPath: 'id' });
      request.result.createObjectStore('kv');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }));
  const run = (store, mode, fn) => open().then((database) => new Promise((resolve, reject) => {
    const tx = database.transaction(store, mode);
    const request = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = tx.onabort = () => reject(tx.error);
  }));
  return {
    all: (store) => run(store, 'readonly', (s) => s.getAll()),
    get: (store, key) => run(store, 'readonly', (s) => s.get(key)),
    put: (store, value, key) => run(store, 'readwrite', (s) => s.put(value, key)),
    del: (store, key) => run(store, 'readwrite', (s) => s.delete(key)),
  };
})();

const THEMES = {
  midnight: { name: 'Midnight', bg: '#000000', text: '#FFFFFF', accent: '#E8B44C' },
  royal: { name: 'Royal', bg: 'linear-gradient(135deg, #0B1B4A 0%, #1E0F4F 100%)', text: '#FFFFFF', accent: '#FFD27A' },
  dawn: { name: 'Dawn', bg: 'linear-gradient(160deg, #3A0F1E 0%, #7A2E12 100%)', text: '#FFF6E8', accent: '#FFC56B' },
  forest: { name: 'Forest', bg: 'linear-gradient(150deg, #052B22 0%, #0E4A2F 100%)', text: '#F4FFF6', accent: '#F2D16B' },
  slate: { name: 'Slate', bg: 'linear-gradient(180deg, #232830 0%, #12151A 100%)', text: '#F1EEE8', accent: '#8FD3FF' },
  paper: { name: 'Paper', bg: '#F6F0E2', text: '#1C1A16', accent: '#8A4B14' },
};
const FONTS = {
  serif: ['Serif', 'Georgia, "Times New Roman", serif'],
  classic: ['Classic', '"Palatino Linotype", Palatino, "Book Antiqua", "URW Palladio L", Georgia, serif'],
  sans: ['Sans', 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'],
};
const DEFAULT_STYLE = { theme: 'midnight', textColor: '', font: 'serif', bold: false, upper: false, scale: 100, align: 'center', refPos: 'bottom', showAbbr: true, verseNums: true, shadow: true, useImage: false, dim: 45 };

const saved = (() => { try { return JSON.parse(localStorage.getItem('versebeam')) || {}; } catch { return {}; } })();
const state = {
  bibles: [],
  bibleId: saved.bibleId || 'kjv',
  b: saved.b ?? 42,
  c: saved.c ?? 3,
  sel: null,
  queue: Array.isArray(saved.queue) ? saved.queue : [],
  style: { ...DEFAULT_STYLE, ...(saved.style || {}) },
  bgImage: '',
  live: { slide: null, blank: false, source: null },
  tab: 'bible',
  outputConnected: false,
  presenting: false,
  lexicon: null,
};
const save = () => {
  try { localStorage.setItem('versebeam', JSON.stringify({ bibleId: state.bibleId, b: state.b, c: state.c, queue: state.queue, style: state.style })); } catch { /* storage unavailable */ }
};

let toastTimer;
function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
}

/* ---------- Bibles ---------- */

const markupToPlain = (raw) => raw.replace(/\{([^|{}]*)\|[^}]*\}/g, '$1').replace(/[[\]]/g, '');
const markupToHtml = (raw, strongs) => esc(raw)
  .replace(/\{([^|{}]*)\|([^}]*)\}/g, (_, words, ids) => (strongs ? `<span class="sw" data-s="${ids}">${words}</span>` : words))
  .replace(/\[([^\]]*)\]/g, '<i>$1</i>');

const bible = (id = state.bibleId) => state.bibles.find((x) => x.id === id) || state.bibles[0];
const chapterCount = (bi, b) => bi.books[b]?.length || 0;
const verseCount = (bi, b, c) => bi.books[b]?.[c - 1]?.length || 0;
const rawVerse = (bi, b, c, v) => bi.books[b]?.[c - 1]?.[v - 1] || '';
const verseText = (bi, b, c, v) => (bi.builtin ? markupToPlain(rawVerse(bi, b, c, v)) : rawVerse(bi, b, c, v));
const firstBook = (bi) => bi.books.findIndex((book) => book?.length);

function slideFor(item) {
  if (!item) return null;
  if (item.kind === 'text') return { kind: 'text', title: item.title || '', text: item.text || '' };
  const bi = bible(item.bibleId);
  const verses = [];
  for (let v = item.v1; v <= item.v2; v++) {
    const text = verseText(bi, item.b, item.c, v);
    if (text) verses.push({ n: v, text });
  }
  return { kind: 'verse', ref: formatReference(item.b, item.c, item.v1, item.v2), abbr: bi.abbr, verses };
}
const itemTitle = (item) => (item.kind === 'text' ? item.title || 'Text slide' : formatReference(item.b, item.c, item.v1, item.v2));
function itemSnippet(item) {
  if (item.kind === 'text') return item.text.replace(/\s+/g, ' ');
  const bi = bible(item.bibleId);
  return `${bi.abbr} · ${verseText(bi, item.b, item.c, item.v1)}`;
}

/* ---------- The projected slide ---------- */

const stages = new Set();
function mountStage(el, sample) {
  el.innerHTML = '<div class="stage-bg"></div><div class="stage-dim"></div><div class="stage-body"><div class="stage-ref" data-pos="top"></div><div class="stage-box"><div class="stage-text"></div></div><div class="stage-ref" data-pos="bottom"></div></div>';
  el._sample = sample || null;
  stages.add(el);
  if ('ResizeObserver' in window) new ResizeObserver(() => fitStage(el)).observe(el);
  paintStage(el);
}

function paintStage(el) {
  const { style, live, bgImage } = state;
  const theme = THEMES[style.theme] || THEMES.midnight;
  const slide = live.slide || (el._sample ? el._sample() : null);
  const useImage = style.useImage && bgImage;
  el.querySelector('.stage-bg').style.background = useImage ? `center / cover no-repeat url("${bgImage}")` : theme.bg;
  el.querySelector('.stage-dim').style.background = useImage ? `rgba(0, 0, 0, ${style.dim / 100})` : 'none';
  el.classList.toggle('blank', live.blank && !el._sample);
  el.classList.toggle('shadow', !!style.shadow);
  el.style.color = style.textColor || theme.text;
  el.style.textAlign = style.align;

  const text = el.querySelector('.stage-text');
  text.style.fontFamily = (FONTS[style.font] || FONTS.serif)[1];
  text.style.fontWeight = style.bold ? '700' : '400';
  text.style.textTransform = style.upper ? 'uppercase' : 'none';
  let html = '';
  let ref = '';
  if (slide?.kind === 'verse') {
    const numbered = style.verseNums && slide.verses.length > 1;
    html = slide.verses.map((v) => (numbered ? `<sup>${v.n}</sup>` : '') + esc(v.text)).join(' ');
    ref = esc(slide.ref) + (style.showAbbr ? `<small>${esc(slide.abbr)}</small>` : '');
  } else if (slide?.kind === 'text') {
    html = (slide.title ? `<div class="stage-title">${esc(slide.title)}</div>` : '') + esc(slide.text).replace(/\n/g, '<br>');
  }
  text.innerHTML = html;
  for (const refEl of el.querySelectorAll('.stage-ref')) {
    const show = ref && style.refPos === refEl.dataset.pos;
    refEl.hidden = !show;
    refEl.innerHTML = show ? ref : '';
    refEl.style.color = theme.accent;
  }
  fitStage(el);
}

// Grows the text to the largest size that still fits the slide.
function fitStage(el) {
  const height = el.clientHeight, width = el.clientWidth;
  if (!height || !width) return;
  el.style.setProperty('--sh', `${height}px`);
  el.style.setProperty('--sw', `${width}px`);
  const box = el.querySelector('.stage-box');
  const text = el.querySelector('.stage-text');
  if (!text.firstChild) return;
  const fits = (size) => {
    text.style.fontSize = `${size}px`;
    return text.offsetHeight <= box.clientHeight + 1 && text.scrollWidth <= box.clientWidth + 1;
  };
  let hi = height * 0.15 * (state.style.scale / 100);
  if (fits(hi)) return;
  let lo = 4;
  for (let i = 0; i < 9; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid; else hi = mid;
  }
  text.style.fontSize = `${lo}px`;
}
const paintAll = () => stages.forEach(paintStage);

/* ---------- Second window / output sync ---------- */

const channel = 'BroadcastChannel' in window ? new BroadcastChannel('versebeam') : null;
let outputWindow = null;
function broadcast() {
  if (channel && !OUTPUT_MODE) channel.postMessage({ type: 'state', live: { slide: state.live.slide, blank: state.live.blank }, style: state.style, bgImage: state.bgImage });
}

/* ---------- Output-only window ---------- */

function startOutputMode() {
  document.body.classList.add('output-mode');
  document.title = 'VerseBeam output';
  const present = $('present');
  present.hidden = false;
  present.classList.add('show-hint');
  mountStage($('presentStage'));
  const hint = $('presentHint');
  hint.hidden = false;
  hint.textContent = 'Drag this window onto the projector screen, then click it for full screen.';
  const goFull = () => {
    hint.hidden = true;
    present.classList.remove('show-hint');
    document.documentElement.requestFullscreen?.().catch(() => {});
  };
  present.addEventListener('click', goFull);
  addEventListener('keydown', (e) => { if (e.key === 'f' || e.key === 'F' || e.key === 'Enter') goFull(); });
  if (!channel) { hint.textContent = 'This browser cannot link two windows. Use Present on the main window instead.'; return; }
  channel.onmessage = ({ data }) => {
    if (data?.type !== 'state') return;
    state.live = { ...data.live, source: null };
    state.style = data.style;
    state.bgImage = data.bgImage;
    paintAll();
  };
  channel.postMessage({ type: 'hello' });
  addEventListener('pagehide', () => channel.postMessage({ type: 'bye' }));
}

/* ---------- Going live ---------- */

function setLive(source) {
  const item = source?.type === 'queue' ? state.queue[source.index] : source;
  state.live = { slide: slideFor(item), blank: false, source };
  afterLiveChange();
}
function show(source) {
  setLive(source);
  if (!state.outputConnected) openPresent();
}
function toggleBlank() {
  if (!state.live.slide) return;
  state.live.blank = !state.live.blank;
  afterLiveChange();
}
function clearLive() {
  state.live = { slide: null, blank: false, source: null };
  afterLiveChange();
}
function afterLiveChange() {
  paintAll();
  broadcast();
  renderLivebar();
  renderVerses(false);
  if (state.tab === 'queue') renderQueue();
  updatePresentInfo();
}

// Moves to the next or previous verse(s) in the Bible, or the next or previous queue item.
function step(dir) {
  const src = state.live.source;
  if (!src) return;
  if (src.type === 'queue') {
    const index = src.index + dir;
    if (index >= 0 && index < state.queue.length) setLive({ type: 'queue', index });
    return;
  }
  if (src.kind === 'text') return;
  const bi = bible(src.bibleId);
  const span = src.v2 - src.v1 + 1;
  let { b, c } = src;
  let v1 = dir > 0 ? src.v2 + 1 : src.v1 - span;
  if (dir > 0 && v1 > verseCount(bi, b, c)) {
    c++;
    if (c > chapterCount(bi, b)) {
      do { b++; } while (b < 66 && !chapterCount(bi, b));
      if (b >= 66) return;
      c = 1;
    }
    v1 = 1;
  } else if (dir < 0 && v1 < 1) {
    if (src.v1 > 1) v1 = 1;
    else {
      c--;
      if (c < 1) {
        do { b--; } while (b >= 0 && !chapterCount(bi, b));
        if (b < 0) return;
        c = chapterCount(bi, b);
      }
      v1 = Math.max(1, verseCount(bi, b, c) - span + 1);
    }
  }
  const v2 = Math.min(v1 + span - 1, verseCount(bi, b, c));
  if (v2 < v1) return;
  state.b = b; state.c = c; state.sel = { v1, v2 };
  save();
  setLive({ type: 'bible', bibleId: bi.id, b, c, v1, v2 });
  renderReaderHead();
  renderVerses(true);
  renderSelbar();
}

/* ---------- Presenting on this device ---------- */

let wakeLock = null;
let hintTimer;
async function keepAwake() {
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* not allowed right now */ }
}
function openPresent() {
  const present = $('present');
  if (!state.presenting) {
    state.presenting = true;
    present.hidden = false;
    $('presentBar').hidden = true;
    const hint = $('presentHint');
    hint.textContent = `Swipe or tap the sides to change verse. Tap the middle for controls.${innerHeight > innerWidth ? ' Turn the phone sideways to fill the screen.' : ''}`;
    hint.hidden = false;
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => { hint.hidden = true; }, 3500);
    const full = present.requestFullscreen?.({ navigationUI: 'hide' });
    if (full) full.then(() => screen.orientation?.lock?.('landscape')).catch(() => {});
    keepAwake();
  }
  paintStage($('presentStage'));
  updatePresentInfo();
}
function closePresent() {
  if (!state.presenting) return;
  state.presenting = false;
  $('present').hidden = true;
  try { screen.orientation?.unlock?.(); } catch { /* unsupported */ }
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  wakeLock?.release?.().catch(() => {});
  wakeLock = null;
  renderLivebar();
}
function updatePresentInfo() {
  const { slide, source, blank } = state.live;
  let info = slide ? (slide.kind === 'verse' ? slide.ref : slide.title || 'Text') : '';
  if (source?.type === 'queue') info = `${source.index + 1}/${state.queue.length} · ${info}`;
  $('presentInfo').textContent = blank ? 'Blank' : info;
}

function setupPresent() {
  const present = $('present');
  const bar = $('presentBar');
  let start = null;
  present.addEventListener('pointerdown', (e) => {
    start = bar.contains(e.target) ? null : { x: e.clientX, y: e.clientY };
  });
  present.addEventListener('pointerup', (e) => {
    if (!start) return;
    const dx = e.clientX - start.x, dy = e.clientY - start.y;
    start = null;
    $('presentHint').hidden = true;
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) { step(dx < 0 ? 1 : -1); return; }
    if (Math.abs(dx) > 12 || Math.abs(dy) > 12) return;
    const zone = e.clientX / innerWidth;
    if (!bar.hidden && zone > 0.3 && zone < 0.7) bar.hidden = true;
    else if (zone < 0.3) step(-1);
    else if (zone > 0.7) step(1);
    else bar.hidden = false;
  });
  bar.addEventListener('click', (e) => {
    const act = e.target.closest('button')?.dataset.act;
    if (act === 'exit') closePresent();
    if (act === 'prev') step(-1);
    if (act === 'next') step(1);
    if (act === 'blank') toggleBlank();
  });
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && state.presenting) closePresent();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.presenting) keepAwake();
  });
  addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');
    if ($('sheet').open || (typing && !state.presenting)) return;
    if (!state.presenting && !state.outputConnected) return;
    const key = e.key;
    if (key === 'ArrowRight' || key === 'ArrowDown' || key === 'PageDown' || (key === ' ' && state.presenting)) { e.preventDefault(); step(1); }
    else if (key === 'ArrowLeft' || key === 'ArrowUp' || key === 'PageUp') { e.preventDefault(); step(-1); }
    else if (key === 'b' || key === 'B' || key === '.') toggleBlank();
    else if (key === 'Escape' && state.presenting) closePresent();
  });
}

/* ---------- Reader ---------- */

function goTo(b, c, v1 = null, v2 = null) {
  const bi = bible();
  if (!chapterCount(bi, b)) b = firstBook(bi);
  c = clamp(c, 1, chapterCount(bi, b));
  state.b = b; state.c = c;
  const count = verseCount(bi, b, c);
  state.sel = v1 && v1 <= count ? { v1, v2: clamp(v2 || v1, v1, count) } : null;
  save();
  renderReaderHead();
  renderVerses(true);
  renderSelbar();
  if (!state.sel) $('main').scrollTop = 0;
}

function renderReaderHead() {
  const bi = bible();
  $('versionBtn').textContent = bi.abbr;
  $('bookBtn').textContent = BOOKS[state.b].name;
  $('chapterBtn').textContent = state.c;
}

function renderVerses(scroll) {
  const bi = bible();
  const list = $('verses');
  const count = verseCount(bi, state.b, state.c);
  const src = state.live.source;
  const liveItem = src?.type === 'queue' ? state.queue[src.index] : src;
  const liveHere = liveItem && liveItem.kind !== 'text' && liveItem.b === state.b && liveItem.c === state.c ? liveItem : null;
  let html = '';
  for (let v = 1; v <= count; v++) {
    const raw = rawVerse(bi, state.b, state.c, v);
    const body = bi.builtin ? markupToHtml(raw, bi.strongs) : esc(raw);
    const cls = ['verse'];
    if (state.sel && v >= state.sel.v1 && v <= state.sel.v2) cls.push('sel');
    if (liveHere && v >= liveHere.v1 && v <= liveHere.v2) cls.push('live');
    if (!raw) cls.push('empty');
    html += `<li class="${cls.join(' ')}" data-v="${v}"><span class="n">${v}</span><span class="t">${body || 'Not in this version'}</span></li>`;
  }
  if (!count) html = `<li class="empty-note">${esc(bi.name)} has no text for ${esc(BOOKS[state.b].name)} ${state.c}.</li>`;
  html += '<li class="chapter-end"><button type="button" class="btn" data-ch="-1">‹ Previous chapter</button><button type="button" class="btn" data-ch="1">Next chapter ›</button></li>';
  list.innerHTML = html;
  if (scroll && state.sel) list.querySelector(`[data-v="${state.sel.v1}"]`)?.scrollIntoView({ block: 'center' });
}

function moveChapter(dir) {
  const bi = bible();
  let b = state.b, c = state.c + dir;
  if (c < 1) {
    do { b--; } while (b >= 0 && !chapterCount(bi, b));
    if (b < 0) return;
    c = chapterCount(bi, b);
  } else if (c > chapterCount(bi, b)) {
    do { b++; } while (b < 66 && !chapterCount(bi, b));
    if (b >= 66) return;
    c = 1;
  }
  goTo(b, c);
}

const currentSelection = () => ({ type: 'bible', bibleId: bible().id, b: state.b, c: state.c, v1: state.sel.v1, v2: state.sel.v2 });

function renderSelbar() {
  const el = $('selbar');
  const visible = !!state.sel && state.tab === 'bible';
  el.hidden = !visible;
  if (!visible) return;
  const canExtend = state.sel.v2 < verseCount(bible(), state.b, state.c);
  el.innerHTML = `
    <button type="button" class="icon-btn" data-act="clear" aria-label="Clear selection">✕</button>
    <div class="label"><b>${esc(formatReference(state.b, state.c, state.sel.v1, state.sel.v2))}</b><span>${esc(bible().abbr)}</span></div>
    <button type="button" class="btn" data-act="more" ${canExtend ? '' : 'disabled'} aria-label="Add the next verse">+1</button>
    <button type="button" class="btn" data-act="queue">Queue</button>
    <button type="button" class="btn live" data-act="show">Show</button>`;
}

function renderLivebar() {
  const el = $('livebar');
  const { slide, blank } = state.live;
  el.hidden = !slide;
  if (!slide) return;
  el.classList.toggle('blanked', blank);
  const title = slide.kind === 'verse' ? slide.ref : slide.title || 'Text slide';
  const status = blank ? 'Screen is blank' : state.outputConnected ? 'Live on output window' : 'Ready, tap to present';
  el.innerHTML = `
    <button type="button" class="thumb" data-act="present" aria-label="Present full screen"><div class="stage" id="thumbStage"></div></button>
    <div class="label"><b>${esc(title)}</b><span>${status}</span></div>
    <button type="button" class="icon-btn" data-act="prev" aria-label="Previous">‹</button>
    <button type="button" class="icon-btn" data-act="next" aria-label="Next">›</button>
    <button type="button" class="icon-btn" data-act="blank" aria-label="${blank ? 'Unblank the screen' : 'Blank the screen'}">${blank ? '◻' : '◼'}</button>
    <button type="button" class="icon-btn" data-act="stop" aria-label="Clear the screen">✕</button>`;
  for (const stage of stages) if (!stage.isConnected) stages.delete(stage);
  mountStage($('thumbStage'));
}

function setupReader() {
  const list = $('verses');
  let pressTimer = null, pressed = false, downAt = null;
  const cancelPress = () => { clearTimeout(pressTimer); pressTimer = null; };
  list.addEventListener('pointerdown', (e) => {
    const li = e.target.closest('.verse');
    pressed = false;
    if (!li) return;
    downAt = { x: e.clientX, y: e.clientY };
    cancelPress();
    pressTimer = setTimeout(() => {
      // Long press: stretch the selection to this verse.
      const v = Number(li.dataset.v);
      pressed = true;
      state.sel = state.sel ? { v1: Math.min(state.sel.v1, v), v2: Math.max(state.sel.v2, v) } : { v1: v, v2: v };
      navigator.vibrate?.(15);
      renderVerses(false);
      renderSelbar();
    }, 480);
  });
  list.addEventListener('pointermove', (e) => {
    if (downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 10) cancelPress();
  });
  for (const type of ['pointerup', 'pointercancel', 'pointerleave']) list.addEventListener(type, cancelPress);
  list.addEventListener('contextmenu', (e) => { if (e.target.closest('.verse')) e.preventDefault(); });

  list.addEventListener('click', (e) => {
    const chapter = e.target.closest('[data-ch]');
    if (chapter) { moveChapter(Number(chapter.dataset.ch)); return; }
    const li = e.target.closest('.verse');
    if (!li || pressed) { pressed = false; return; }
    const word = e.target.closest('.sw');
    if (word) { openLexicon(word.dataset.s.split(' '), word.textContent); return; }
    const v = Number(li.dataset.v);
    if (li.classList.contains('empty')) return;
    if (state.sel && v >= state.sel.v1 && v <= state.sel.v2) { show(currentSelection()); return; }
    state.sel = { v1: v, v2: v };
    renderVerses(false);
    renderSelbar();
  });

  $('selbar').addEventListener('click', (e) => {
    const act = e.target.closest('button')?.dataset.act;
    if (!act || !state.sel) return;
    if (act === 'clear') state.sel = null;
    if (act === 'more') state.sel.v2++;
    if (act === 'queue') {
      const { type, ...item } = currentSelection();
      state.queue.push(item);
      save();
      renderTabs();
      toast(`Added ${formatReference(item.b, item.c, item.v1, item.v2)} to the queue`);
    }
    if (act === 'show') { show(currentSelection()); return; }
    renderVerses(false);
    renderSelbar();
  });

  $('livebar').addEventListener('click', (e) => {
    const act = e.target.closest('button')?.dataset.act;
    if (act === 'present') { if (state.outputConnected) toast('Already live on the output window'); else openPresent(); }
    if (act === 'prev') step(-1);
    if (act === 'next') step(1);
    if (act === 'blank') toggleBlank();
    if (act === 'stop') clearLive();
  });

  $('prevCh').addEventListener('click', () => moveChapter(-1));
  $('nextCh').addEventListener('click', () => moveChapter(1));
  $('bookBtn').addEventListener('click', openBookSheet);
  $('chapterBtn').addEventListener('click', () => openChapterSheet(state.b));
  $('versionBtn').addEventListener('click', openVersionSheet);
}

/* ---------- Search ---------- */

function searchIndex(bi) {
  if (bi._index) return bi._index;
  const index = [];
  bi.books.forEach((book, b) => book?.forEach((chapter, c) => chapter.forEach((raw, v) => {
    if (raw) index.push([b, c + 1, v + 1, (bi.builtin ? markupToPlain(raw) : raw).toLowerCase()]);
  })));
  return (bi._index = index);
}

function runSearch(query) {
  const box = $('results');
  query = query.trim();
  if (!query) { box.hidden = true; $('verses').hidden = false; return; }
  const bi = bible();
  let html = '';
  const ref = parseReference(query);
  if (ref && chapterCount(bi, ref.b) >= ref.c) {
    const label = formatReference(ref.b, ref.c, ref.v1, ref.v2);
    const preview = ref.v1 ? verseText(bi, ref.b, ref.c, ref.v1) : `${verseCount(bi, ref.b, ref.c)} verses`;
    html += `<button type="button" class="result go" data-ref="${ref.b},${ref.c},${ref.v1 || ''},${ref.v2 || ''}"><b>Go to ${esc(label)}</b><span>${esc(preview)}</span></button>`;
  }
  const strongsId = bi.strongs && /^[gh]\d{1,4}$/i.test(query) ? query.toUpperCase() : null;
  if (strongsId) {
    const pattern = new RegExp(`[| ]${strongsId}[ }]`);
    const hits = [];
    bi.books.forEach((book, b) => book.forEach((chapter, c) => chapter.forEach((raw, v) => {
      if (pattern.test(raw)) hits.push([b, c + 1, v + 1, markupToPlain(raw)]);
    })));
    html += resultRows(hits, null, `${plural(hits.length)} ${hits.length === 1 ? 'uses' : 'use'} ${strongsId}`);
  } else if (query.length >= 3) {
    const phrase = query.match(/^"(.+)"$/);
    const terms = phrase ? [phrase[1].toLowerCase()] : query.toLowerCase().split(/\s+/).filter((t) => t.length > 1);
    if (terms.length) {
      const hits = searchIndex(bi).filter((row) => terms.every((t) => row[3].includes(t)));
      const marker = new RegExp(`(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
      html += resultRows(hits.map(([b, c, v]) => [b, c, v, verseText(bi, b, c, v)]), marker, `${plural(hits.length)} in ${bi.abbr}`);
    }
  }
  box.innerHTML = html || '<div class="results-note">Type a reference like “John 3:16”, or at least three letters to search.</div>';
  box.hidden = false;
  $('verses').hidden = true;
  $('main').scrollTop = 0;
}

function resultRows(hits, marker, note) {
  const LIMIT = 150;
  let html = `<div class="results-note">${esc(note)}${hits.length > LIMIT ? `, showing the first ${LIMIT}` : ''}</div>`;
  for (const [b, c, v, text] of hits.slice(0, LIMIT)) {
    const body = marker ? esc(text).replace(marker, '<mark>$1</mark>') : esc(text);
    html += `<button type="button" class="result" data-ref="${b},${c},${v},${v}"><b>${esc(formatReference(b, c, v))}</b><span>${body}</span></button>`;
  }
  return html;
}

function closeSearch() {
  $('search').value = '';
  $('results').hidden = true;
  $('verses').hidden = false;
}

function setupSearch() {
  const input = $('search');
  let timer;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => runSearch(input.value), 220);
  });
  $('searchForm').addEventListener('submit', (e) => {
    e.preventDefault();
    clearTimeout(timer);
    runSearch(input.value);
    const first = $('results').querySelector('.result.go');
    if (first) first.click();
    input.blur();
  });
  $('results').addEventListener('click', (e) => {
    const row = e.target.closest('[data-ref]');
    if (!row) return;
    const [b, c, v1, v2] = row.dataset.ref.split(',').map((n) => (n === '' ? null : Number(n)));
    closeSearch();
    goTo(b, c, v1, v2);
  });
}

/* ---------- Sheets ---------- */

function openSheet(title, bodyHtml) {
  const sheet = $('sheet');
  sheet.innerHTML = `<div class="sheet-head"><h2>${esc(title)}</h2><button type="button" class="icon-btn" data-close aria-label="Close">✕</button></div><div class="sheet-body">${bodyHtml}</div>`;
  if (!sheet.open) sheet.showModal();
  sheet.querySelector('.sheet-body').scrollTop = 0;
  return sheet.querySelector('.sheet-body');
}
const closeSheet = () => { if ($('sheet').open) $('sheet').close(); };

function openBookSheet() {
  const bi = bible();
  const group = (from, to) => BOOKS.slice(from, to).map((book) =>
    `<button type="button" data-book="${book.index}" ${chapterCount(bi, book.index) ? '' : 'disabled'} ${book.index === state.b ? 'aria-current="true"' : ''}>${esc(book.name)}</button>`).join('');
  const body = openSheet('Choose a book', `<h3>Old Testament</h3><div class="grid books">${group(0, 39)}</div><h3 style="margin-top:18px">New Testament</h3><div class="grid books">${group(39, 66)}</div>`);
  body.querySelector('[aria-current]')?.scrollIntoView({ block: 'center' });
  body.onclick = (e) => {
    const b = e.target.closest('[data-book]')?.dataset.book;
    if (b == null) return;
    if (chapterCount(bi, Number(b)) === 1) { closeSheet(); goTo(Number(b), 1); } else openChapterSheet(Number(b));
  };
}

function openChapterSheet(b) {
  const total = chapterCount(bible(), b);
  let html = '<div class="grid nums">';
  for (let c = 1; c <= total; c++) html += `<button type="button" data-chapter="${c}" ${b === state.b && c === state.c ? 'aria-current="true"' : ''}>${c}</button>`;
  const body = openSheet(BOOKS[b].name, `${html}</div>`);
  body.onclick = (e) => {
    const c = e.target.closest('[data-chapter]')?.dataset.chapter;
    if (c == null) return;
    closeSheet();
    closeSearch();
    goTo(b, Number(c));
  };
}

function openVersionSheet() {
  const rows = state.bibles.map((bi) => `<li><button type="button" class="main" data-bible="${esc(bi.id)}"><b>${esc(bi.name)}</b><span>${esc(bi.abbr)}${bi.builtin ? ' · built in' : ' · imported'}</span></button>${bi.id === state.bibleId ? '<span class="tag on">IN USE</span>' : ''}</li>`).join('');
  const body = openSheet('Bible version', `<ul class="list">${rows}</ul><p class="muted small" style="margin-top:16px">Add NKJV, NIV, NLT, MSG, AMP and others from your own files in the Library tab.</p>`);
  body.onclick = (e) => {
    const id = e.target.closest('[data-bible]')?.dataset.bible;
    if (!id) return;
    closeSheet();
    useBible(id);
  };
}

function useBible(id) {
  state.bibleId = id;
  const keep = state.sel;
  closeSearch();
  goTo(state.b, state.c, keep?.v1, keep?.v2);
  if (state.tab === 'library') renderLibrary();
}

async function openLexicon(ids, word) {
  const body = openSheet(`“${word.trim()}”`, '<p class="muted">Loading dictionary…</p>');
  try {
    state.lexicon ||= await (await fetch('data/strongs.json')).json();
  } catch {
    body.innerHTML = '<p>The Strong’s dictionary could not be loaded. Open the app once with internet so it can be saved for offline use.</p>';
    return;
  }
  body.innerHTML = ids.map((id) => {
    const entry = state.lexicon[id];
    if (!entry) return `<div class="lex-entry"><b>${esc(id)}</b><p class="muted">No dictionary entry.</p></div>`;
    const [lemma, translit, pron, def, kjv, origin] = entry;
    return `<div class="lex-entry">
      <div class="lex-word" lang="${id[0] === 'H' ? 'he' : 'el'}" dir="auto">${esc(lemma)}</div>
      <div class="muted">${esc(translit)}${pron ? ` · ${esc(pron)}` : ''} · ${id[0] === 'H' ? 'Hebrew' : 'Greek'} ${esc(id)}</div>
      <dl>
        <div><dt>Meaning</dt><dd>${esc(def) || '—'}</dd></div>
        ${kjv ? `<div><dt>Translated in the KJV as</dt><dd>${esc(kjv)}</dd></div>` : ''}
        ${origin ? `<div><dt>Origin</dt><dd>${esc(origin)}</dd></div>` : ''}
      </dl>
      <div class="row wrap"><button type="button" class="btn" data-find="${esc(id)}">Find verses</button><button type="button" class="btn" data-project="${esc(id)}">Show on screen</button></div>
    </div>`;
  }).join('');
  body.onclick = (e) => {
    const find = e.target.closest('[data-find]')?.dataset.find;
    const project = e.target.closest('[data-project]')?.dataset.project;
    if (find) { closeSheet(); $('search').value = find; runSearch(find); }
    if (project) {
      const [lemma, translit, , def] = state.lexicon[project];
      closeSheet();
      show({ kind: 'text', title: `${lemma}  ·  ${translit}  (${project})`, text: def });
    }
  };
}

/* ---------- Queue ---------- */

function renderQueue() {
  const el = $('tab-queue');
  const playing = state.live.source?.type === 'queue' ? state.live.source.index : -1;
  const rows = state.queue.map((item, i) => `<li class="${i === playing ? 'playing' : ''}">
      <button type="button" class="main" data-play="${i}"><b>${i + 1}. ${esc(itemTitle(item))}</b><span>${esc(itemSnippet(item))}</span></button>
      <button type="button" class="icon-btn" data-up="${i}" ${i ? '' : 'disabled'} aria-label="Move up">↑</button>
      <button type="button" class="icon-btn" data-down="${i}" ${i < state.queue.length - 1 ? '' : 'disabled'} aria-label="Move down">↓</button>
      <button type="button" class="icon-btn" data-remove="${i}" aria-label="Remove">✕</button>
    </li>`).join('');
  el.innerHTML = `
    <h2>Service queue</h2>
    <p class="muted">Line up verses before the service, then swipe through them while presenting.</p>
    <div class="row wrap" style="margin:14px 0">
      <button type="button" class="btn live" data-act="start" ${state.queue.length ? '' : 'disabled'}>Present from start</button>
      <button type="button" class="btn" data-act="text">Add text slide</button>
      <button type="button" class="btn ghost" data-act="clear" ${state.queue.length ? '' : 'disabled'}>Clear all</button>
    </div>
    ${state.queue.length ? `<div class="card"><ul class="list">${rows}</ul></div>` : '<div class="card"><p class="muted">Nothing queued yet. In the Bible tab, tap a verse and choose <b>Queue</b>.</p></div>'}`;
}

function setupQueue() {
  $('tab-queue').addEventListener('click', (e) => {
    const button = e.target.closest('button');
    if (!button) return;
    const d = button.dataset;
    const swap = (i, j) => {
      [state.queue[i], state.queue[j]] = [state.queue[j], state.queue[i]];
      const src = state.live.source;
      if (src?.type === 'queue') src.index = src.index === i ? j : src.index === j ? i : src.index;
    };
    if (d.play != null) { show({ type: 'queue', index: Number(d.play) }); return; }
    if (d.up != null) swap(Number(d.up), Number(d.up) - 1);
    if (d.down != null) swap(Number(d.down), Number(d.down) + 1);
    if (d.remove != null) {
      const i = Number(d.remove);
      state.queue.splice(i, 1);
      const src = state.live.source;
      if (src?.type === 'queue') {
        if (src.index === i) state.live.source = null;
        else if (src.index > i) src.index--;
      }
    }
    if (d.act === 'start') { show({ type: 'queue', index: 0 }); return; }
    if (d.act === 'clear') {
      if (!confirm('Remove every item from the queue?')) return;
      state.queue = [];
      if (state.live.source?.type === 'queue') state.live.source = null;
    }
    if (d.act === 'text') { openTextSlideSheet(); return; }
    save();
    renderQueue();
    renderTabs();
  });
}

function openTextSlideSheet() {
  const body = openSheet('Text slide', `
    <label class="field"><span>Heading (optional)</span><input type="text" id="slideTitle" maxlength="80"></label>
    <label class="field"><span>Text</span><textarea id="slideText" placeholder="An announcement, a sermon point, a prayer…"></textarea></label>
    <button type="button" class="btn primary block" id="slideSave">Add to queue</button>`);
  body.querySelector('#slideSave').onclick = () => {
    const title = body.querySelector('#slideTitle').value.trim();
    const text = body.querySelector('#slideText').value.trim();
    if (!title && !text) return;
    state.queue.push({ kind: 'text', title, text });
    save();
    closeSheet();
    renderQueue();
    renderTabs();
  };
}

/* ---------- Display settings ---------- */

const SAMPLE = () => ({ kind: 'verse', ref: 'John 3:16', abbr: bible().abbr, verses: [{ n: 16, text: verseText(bible(), 42, 3, 16) || 'For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.' }] });

function renderDisplay() {
  const s = state.style;
  const seg = (key, options) => `<div class="seg">${options.map(([value, label]) => `<button type="button" data-set="${key}" data-value="${value}" aria-pressed="${String(s[key]) === String(value)}">${label}</button>`).join('')}</div>`;
  const toggle = (key, label) => `<label class="switch"><span>${label}</span><input type="checkbox" data-toggle="${key}" ${s[key] ? 'checked' : ''}></label>`;
  $('tab-display').innerHTML = `
    <div class="preview-wrap"><div class="stage" id="previewStage"></div></div>
    <div class="card">
      <h3>Screen</h3>
      <div class="row wrap">
        <button type="button" class="btn live" data-act="present">Present on this device</button>
        <button type="button" class="btn" data-act="window">${state.outputConnected ? 'Output window is open' : 'Open output window'}</button>
      </div>
      <p class="muted small" style="margin-top:10px">On a phone, mirror your screen to the TV or projector and use <b>Present</b>. On a laptop, open the output window and drag it onto the projector.</p>
    </div>
    <div class="card">
      <h3>Background</h3>
      <div class="swatches">${Object.entries(THEMES).map(([id, t]) => `<button type="button" class="swatch" data-theme="${id}" aria-pressed="${s.theme === id && !(s.useImage && state.bgImage)}" style="background:${t.bg};color:${t.text}">${t.name}</button>`).join('')}</div>
      <div class="row wrap" style="margin-top:12px">
        <button type="button" class="btn" data-act="image">${state.bgImage ? 'Change picture' : 'Use a picture'}</button>
        ${state.bgImage ? `<button type="button" class="btn ghost" data-act="noimage">Remove picture</button>` : ''}
        <input type="file" id="bgFile" accept="image/*" hidden>
      </div>
      ${state.bgImage ? `<div style="margin-top:12px">${toggle('useImage', 'Show the picture')}</div><label class="field"><span>Darken the picture</span><input type="range" min="0" max="85" step="5" value="${s.dim}" data-range="dim"></label>` : ''}
    </div>
    <div class="card">
      <h3>Text</h3>
      <div class="field"><span>Font</span>${seg('font', Object.entries(FONTS).map(([id, f]) => [id, f[0]]))}</div>
      <div class="field"><span>Alignment</span>${seg('align', [['left', 'Left'], ['center', 'Centre'], ['right', 'Right']])}</div>
      <label class="field"><span>Largest text size</span><input type="range" min="50" max="160" step="5" value="${s.scale}" data-range="scale"></label>
      <div class="row" style="margin-bottom:8px"><input type="color" id="textColor" value="${s.textColor || (THEMES[s.theme] || THEMES.midnight).text}" aria-label="Text colour"><span>Text colour</span><span class="spacer"></span>${s.textColor ? '<button type="button" class="btn ghost" data-act="resetcolor">Reset</button>' : ''}</div>
      ${toggle('bold', 'Bold')}${toggle('upper', 'All capitals')}${toggle('shadow', 'Shadow behind text')}
    </div>
    <div class="card">
      <h3>Reference</h3>
      <div class="field"><span>Where to show “John 3:16”</span>${seg('refPos', [['top', 'Top'], ['bottom', 'Bottom'], ['hidden', 'Hidden']])}</div>
      ${toggle('showAbbr', 'Show the version, e.g. KJV')}${toggle('verseNums', 'Verse numbers when showing several verses')}
    </div>`;
  for (const stage of stages) if (!stage.isConnected) stages.delete(stage);
  mountStage($('previewStage'), SAMPLE);
}

function styleChanged(rerender) {
  save();
  if (rerender) renderDisplay(); else paintAll();
  if (rerender) paintAll();
  broadcast();
}

function openOutputWindow() {
  if (!channel) { toast('This browser cannot link two windows'); return; }
  if (outputWindow && !outputWindow.closed) { outputWindow.focus(); return; }
  outputWindow = window.open('./?output=1', 'versebeam-output', 'popup,width=960,height=540');
  if (!outputWindow) toast('Allow pop-ups for this page, then try again');
}

function setupDisplay() {
  const el = $('tab-display');
  el.addEventListener('click', (e) => {
    const button = e.target.closest('button');
    if (!button) return;
    const d = button.dataset;
    if (d.theme) { state.style.theme = d.theme; state.style.textColor = ''; state.style.useImage = false; styleChanged(true); }
    else if (d.set) { state.style[d.set] = d.value; styleChanged(true); }
    else if (d.act === 'present') { if (state.outputConnected) toast('Already live on the output window'); else openPresent(); }
    else if (d.act === 'window') openOutputWindow();
    else if (d.act === 'image') $('bgFile').click();
    else if (d.act === 'noimage') { state.bgImage = ''; state.style.useImage = false; db.del('kv', 'bgImage').catch(() => {}); styleChanged(true); }
    else if (d.act === 'resetcolor') { state.style.textColor = ''; styleChanged(true); }
  });
  el.addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.range) { state.style[t.dataset.range] = Number(t.value); styleChanged(false); }
    else if (t.id === 'textColor') { state.style.textColor = t.value; styleChanged(false); }
  });
  el.addEventListener('change', async (e) => {
    const t = e.target;
    if (t.dataset.toggle) { state.style[t.dataset.toggle] = t.checked; styleChanged(false); }
    else if (t.id === 'textColor') styleChanged(true);
    else if (t.id === 'bgFile' && t.files[0]) {
      try {
        state.bgImage = await shrinkImage(t.files[0]);
        state.style.useImage = true;
        db.put('kv', state.bgImage, 'bgImage').catch(() => toast('The picture could not be saved for next time'));
        styleChanged(true);
      } catch { toast('That picture could not be opened'); }
    }
  });
}

// Scales a photo down to projector size so it stays small enough to store.
function shrinkImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const ratio = Math.min(1, 1920 / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * ratio);
      canvas.height = Math.round(img.height * ratio);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('bad image')); };
    img.src = url;
  });
}

/* ---------- Library ---------- */

let offlineReady = null;
async function checkOffline() {
  try {
    offlineReady = !!(await caches.match('data/kjv.json', { ignoreSearch: true })) && !!(await caches.match('data/strongs.json', { ignoreSearch: true }));
  } catch { offlineReady = false; }
  if (state.tab === 'library') renderLibrary();
}

function renderLibrary() {
  const rows = state.bibles.map((bi) => `<li>
      <button type="button" class="main" data-use="${esc(bi.id)}"><b>${esc(bi.name)}</b><span>${esc(bi.abbr)} · ${bi.builtin ? 'built in' : `${bi.books.filter((b) => b?.length).length} books, imported`}</span></button>
      ${bi.id === state.bibleId ? '<span class="tag on">IN USE</span>' : ''}
      ${bi.builtin ? '' : `<button type="button" class="icon-btn" data-delete="${esc(bi.id)}" aria-label="Delete ${esc(bi.name)}">✕</button>`}
    </li>`).join('');
  const offline = offlineReady == null ? 'Checking…' : offlineReady ? 'Saved on this device. Works without internet.' : 'Not saved yet. Stay online for a moment while it downloads.';
  $('tab-library').innerHTML = `
    <h2>VerseBeam</h2>
    <p class="muted">Bible verses from your phone to the big screen.</p>
    <div class="card" style="margin-top:14px">
      <h3>Bible versions</h3>
      <ul class="list">${rows}</ul>
    </div>
    <div class="card">
      <h3>Add your own Bible</h3>
      <p>NKJV, NIV, NLT, MSG, AMP and other modern versions are copyrighted, so they are not included. If you have a file of a version you are licensed to use, add it here. It stays on this device only.</p>
      <button type="button" class="btn primary block" data-act="import">Import Bible files</button>
      <input type="file" id="bibleFile" multiple hidden>
      <p class="muted small" style="margin-top:10px">Reads XML (Zefania, OSIS, USFX, OpenSong), JSON, USFM, theWord (.ont, .nt, .ot) and plain text with one verse per line such as “John 3:16 For God so loved…”. For USFM, pick all the book files together.</p>
    </div>
    <div class="card">
      <h3>Offline</h3>
      <p><span class="tag ${offlineReady ? 'on' : ''}">${offlineReady ? 'READY' : 'PENDING'}</span> ${offline}</p>
      <p class="muted small">Add the app to your home screen from the browser menu (Share → Add to Home Screen on iPhone, Install app on Android) so it opens full screen.</p>
    </div>
    <div class="card">
      <h3>Connecting to a screen</h3>
      <ol class="steps">
        <li><b>Cable:</b> plug the phone into the TV or projector with a USB-C or Lightning to HDMI adapter.</li>
        <li><b>Wireless:</b> use AirPlay (iPhone), or Cast / Smart View / Screen Mirroring (Android). None of these need internet.</li>
        <li><b>Laptop:</b> open this page on the laptop, then use <b>Open output window</b> in the Display tab.</li>
        <li>Tap a verse, tap <b>Show</b>, and turn the phone sideways. Swipe for the next verse.</li>
      </ol>
      <p class="muted small" style="margin-top:10px">Mirroring shows everything on your phone, so queue your verses first and blank the screen before searching for a new one. A Bluetooth presenter clicker also works for next and previous.</p>
    </div>
    <div class="card">
      <h3>Credits</h3>
      <p class="muted small">King James Version (1769) with Strong’s numbers from the CrossWire Bible Society, public domain. Strong’s Hebrew and Greek dictionaries from Open Scriptures, licensed CC BY-SA.</p>
    </div>`;
}

function setupLibrary() {
  const el = $('tab-library');
  el.addEventListener('click', async (e) => {
    const button = e.target.closest('button');
    if (!button) return;
    const d = button.dataset;
    if (d.use) { useBible(d.use); toast(`Now using ${bible().abbr}`); }
    if (d.act === 'import') $('bibleFile').click();
    if (d.delete) {
      const target = bible(d.delete);
      if (!confirm(`Delete ${target.name} from this device?`)) return;
      await db.del('bibles', d.delete).catch(() => {});
      state.bibles = state.bibles.filter((bi) => bi.id !== d.delete);
      if (state.bibleId === d.delete) useBible('kjv');
      renderLibrary();
    }
  });
  el.addEventListener('change', async (e) => {
    if (e.target.id !== 'bibleFile' || !e.target.files.length) return;
    const files = [...e.target.files];
    e.target.value = '';
    toast('Reading…');
    const shape = bible('kjv').books.map((book) => book.map((chapter) => chapter.length));
    const result = await importFiles(files, shape);
    openImportSheet(files, result);
  });
}

function openImportSheet(files, result) {
  const problems = result.problems.length ? `<div class="card"><h3>Problems</h3>${result.problems.map((p) => `<p class="small">${esc(p)}</p>`).join('')}</div>` : '';
  if (!result.verses) {
    openSheet('Nothing imported', `${problems}<p class="muted">No Bible text was found. Try an XML, JSON, USFM or text export of the same Bible.</p>`);
    return;
  }
  const base = files[0].name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
  const guess = (base.match(/\b[A-Za-z]{2,5}\d{0,4}\b/g) || []).find((w) => w === w.toUpperCase()) || base.split(' ')[0].slice(0, 6);
  const body = openSheet('Import Bible', `
    <p>Found <b>${result.verses.toLocaleString()} verses</b> in <b>${result.bookCount} ${result.bookCount === 1 ? 'book' : 'books'}</b>.</p>
    ${result.bookCount < 66 ? `<p class="muted small">Not a full Bible: ${result.bookCount === 27 && !result.books[0] ? 'New Testament only.' : 'some books are missing.'}</p>` : ''}
    ${problems}
    <label class="field"><span>Name</span><input type="text" id="importName" maxlength="60" value="${esc(base)}"></label>
    <label class="field"><span>Short name shown on screen</span><input type="text" id="importAbbr" maxlength="8" value="${esc(guess.toUpperCase())}"></label>
    <button type="button" class="btn primary block" id="importSave">Save this Bible</button>`);
  body.querySelector('#importSave').onclick = async () => {
    const name = body.querySelector('#importName').value.trim() || 'My Bible';
    const abbr = body.querySelector('#importAbbr').value.trim() || name.slice(0, 6).toUpperCase();
    const record = { id: `u${Date.now()}`, name, abbr, books: result.books };
    try {
      await db.put('bibles', record);
      navigator.storage?.persist?.().catch(() => {});
    } catch {
      toast('This Bible could not be saved. The device may be out of space.');
      return;
    }
    state.bibles.push(record);
    closeSheet();
    useBible(record.id);
    toast(`${abbr} added`);
  };
}

/* ---------- Tabs ---------- */

const TAB_ICONS = {
  bible: '<path d="M12 6.5C10 5 7 4.5 4 5v13c3-.5 6 0 8 1.5m0-13c2-1.5 5-2 8-1.5v13c-3-.5-6 0-8 1.5m0-13v13"/>',
  queue: '<path d="M4 6h12M4 12h12M4 18h8M19 14l3 2-3 2z"/>',
  display: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  library: '<path d="M5 4v16M10 4v16M14.5 5l4.5 14.5"/>',
};
function renderTabs() {
  $('tabs').innerHTML = Object.entries({ bible: 'Bible', queue: 'Queue', display: 'Display', library: 'Library' }).map(([id, label]) =>
    `<button type="button" data-tab="${id}" ${state.tab === id ? 'aria-current="page"' : ''}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${TAB_ICONS[id]}</svg>${label}${id === 'queue' && state.queue.length ? `<span class="count">${state.queue.length}</span>` : ''}</button>`).join('');
}
function switchTab(tab) {
  state.tab = tab;
  for (const id of ['bible', 'queue', 'display', 'library']) $(`tab-${id}`).hidden = id !== tab;
  if (tab === 'queue') renderQueue();
  if (tab === 'display') renderDisplay();
  if (tab === 'library') renderLibrary();
  renderTabs();
  renderSelbar();
  $('main').scrollTop = 0;
  if (tab === 'bible' && state.sel) $('verses').querySelector('.sel')?.scrollIntoView({ block: 'center' });
}

/* ---------- Start ---------- */

async function start() {
  if (OUTPUT_MODE) { startOutputMode(); return; }

  $('verses').innerHTML = '<li class="empty-note">Loading the Bible…</li>';
  renderTabs();
  $('tabs').addEventListener('click', (e) => {
    const tab = e.target.closest('[data-tab]')?.dataset.tab;
    if (tab) switchTab(tab);
  });
  $('sheet').addEventListener('click', (e) => {
    if (e.target === $('sheet') || e.target.closest('[data-close]')) closeSheet();
  });

  let kjv;
  try {
    kjv = await (await fetch('data/kjv.json')).json();
  } catch {
    $('verses').innerHTML = '<li class="empty-note">The Bible could not be loaded. Connect to the internet once and reload so it can be saved on this device.</li>';
    return;
  }
  state.bibles = [
    { id: 'kjv', name: 'King James Version', abbr: 'KJV', builtin: true, strongs: false, books: kjv },
    { id: 'kjvs', name: 'KJV with Strong’s numbers', abbr: 'KJV+', builtin: true, strongs: true, books: kjv },
  ];
  try {
    state.bibles.push(...(await db.all('bibles')));
    state.bgImage = (await db.get('kv', 'bgImage')) || '';
  } catch { /* private browsing: imported Bibles are unavailable */ }
  if (!state.bibles.some((bi) => bi.id === state.bibleId)) state.bibleId = 'kjv';
  state.queue = state.queue.filter((item) => item && (item.kind === 'text' || (item.b >= 0 && item.b < 66 && item.c && item.v1)));

  mountStage($('presentStage'));
  setupReader();
  setupSearch();
  setupQueue();
  setupDisplay();
  setupLibrary();
  setupPresent();
  goTo(state.b, state.c);

  if (channel) {
    channel.onmessage = ({ data }) => {
      if (data?.type === 'hello') { state.outputConnected = true; closePresent(); broadcast(); }
      if (data?.type === 'bye') state.outputConnected = false;
      if (data?.type === 'hello' || data?.type === 'bye') {
        renderLivebar();
        if (state.tab === 'display') renderDisplay();
      }
    };
    setInterval(() => {
      if (state.outputConnected && outputWindow?.closed) {
        state.outputConnected = false;
        renderLivebar();
        if (state.tab === 'display') renderDisplay();
      }
    }, 1500);
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').then(() => navigator.serviceWorker.ready).then(() => setTimeout(checkOffline, 1500)).catch(() => { offlineReady = false; });
  } else offlineReady = false;
}

start();
