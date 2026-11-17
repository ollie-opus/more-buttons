/**
 * kbDatePicker.js — a small calendar that opens under a date on the page, for
 * the in-page editor (an update's "Date of release", kbPageEditor.js).
 *
 * It is drawn here rather than borrowed from the browser: the browser's own
 * calendar can only be asked for through a hidden field, and on the Knowledge
 * Base site that opened nothing.
 *
 *     ‹  November 2026  ›
 *     Mo Tu We Th Fr Sa Su
 *     …  a month of days …
 *     Today          Clear
 *
 * A click on a day picks it and closes the calendar; Clear picks no date.
 * Escape or a press anywhere else closes it with nothing changed. Arrow keys
 * move by a day or a week, Page Up / Down by a month. Weeks start on Monday.
 *
 * Dates are `YYYY-MM-DD` strings throughout. calendarDays / shiftDate are pure
 * and Node-tested; the rest needs a DOM.
 */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const GAP = 6;  // px between the date and the calendar
const EDGE = 8; // px the calendar keeps inside the window

const pad = n => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const parts = s => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s ?? ''); return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null; };
const utc = s => { const p = parts(s); return p ? new Date(Date.UTC(p[0], p[1] - 1, p[2])) : null; };
const isoOf = date => iso(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());

/** Today, as the user's own clock has it. */
export function todayIso(now = new Date()) {
  return iso(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

/** `date` moved by whole days and / or months (a month move keeps the day where the month has it, else its last). */
export function shiftDate(date, { days = 0, months = 0 } = {}) {
  const p = parts(date);
  if (!p) return date;
  let [y, m, d] = p;
  if (months) {
    const total = y * 12 + (m - 1) + months;
    y = Math.floor(total / 12);
    m = (total % 12 + 12) % 12 + 1;
    d = Math.min(d, new Date(Date.UTC(y, m, 0)).getUTCDate());
  }
  const out = new Date(Date.UTC(y, m - 1, d));
  out.setUTCDate(out.getUTCDate() + days);
  return isoOf(out);
}

/**
 * The six weeks a month is shown in, Monday first: 42 days, those of the
 * months either side filling the first and last weeks.
 * @param {number} year @param {number} month 1-12
 * @returns {Array<{date: string, day: number, inMonth: boolean}>}
 */
export function calendarDays(year, month) {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const lead = (first.getUTCDay() + 6) % 7; // days of the month before, back to Monday
  const out = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(Date.UTC(year, month - 1, 1 - lead + i));
    out.push({ date: isoOf(d), day: d.getUTCDate(), inMonth: d.getUTCMonth() === month - 1 });
  }
  return out;
}

let current = null; // the one open calendar: { el, close }

/** Put away the open calendar, if there is one. */
export function closeDatePicker() {
  current?.close();
}

/**
 * Open the calendar under `anchor`.
 * @param {Element} anchor
 * @param {object} o
 * @param {string} [o.value]  the date picked now ('' for none)
 * @param {(date: string) => void} o.onPick  called with the chosen date, or '' for Clear
 * @param {string} [o.label]  what the date is, for a screen reader
 */
export function openDatePicker(anchor, { value = '', onPick, label = 'Date' }) {
  closeDatePicker();
  const today = todayIso();
  const picked = parts(value) ? value : '';
  let focus = picked || today; // the day the keys move from
  let [year, month] = parts(focus);

  const el = document.createElement('div');
  el.className = 'mb-kb-cal';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', label);

  const button = (cls, text, aria) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.textContent = text;
    if (aria) b.setAttribute('aria-label', aria);
    return b;
  };
  const head = document.createElement('div');
  head.className = 'mb-kb-cal__head';
  const prev = button('mb-kb-cal__nav', '‹', 'Previous month');
  const next = button('mb-kb-cal__nav', '›', 'Next month');
  const title = document.createElement('strong');
  title.setAttribute('aria-live', 'polite');
  head.append(prev, title, next);

  const week = document.createElement('div');
  week.className = 'mb-kb-cal__week';
  week.setAttribute('aria-hidden', 'true');
  week.append(...WEEKDAYS.map(d => { const s = document.createElement('span'); s.textContent = d; return s; }));

  const grid = document.createElement('div');
  grid.className = 'mb-kb-cal__grid';

  const foot = document.createElement('div');
  foot.className = 'mb-kb-cal__foot';
  const todayBtn = button('mb-kb-cal__link', 'Today');
  const clearBtn = button('mb-kb-cal__link', 'Clear');
  clearBtn.hidden = !picked;
  foot.append(todayBtn, clearBtn);

  el.append(head, week, grid, foot);

  function draw(takeFocus = false) {
    title.textContent = `${MONTHS[month - 1]} ${year}`;
    grid.replaceChildren(...calendarDays(year, month).map(d => {
      const b = button('mb-kb-cal__day', String(d.day));
      b.dataset.date = d.date;
      if (!d.inMonth) b.classList.add('--out');
      if (d.date === today) b.classList.add('--today');
      if (d.date === picked) { b.classList.add('--picked'); b.setAttribute('aria-pressed', 'true'); }
      b.tabIndex = d.date === focus ? 0 : -1;
      return b;
    }));
    if (takeFocus) grid.querySelector(`[data-date="${focus}"]`)?.focus({ preventScroll: true });
  }

  function show(date, takeFocus = true) {
    focus = date;
    [year, month] = parts(date);
    draw(takeFocus);
  }

  function place() {
    const r = anchor.getBoundingClientRect();
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    const x = Math.max(EDGE, Math.min(r.left, vw - w - EDGE));
    // Under the date; above it when there is no room below.
    const y = r.bottom + GAP + h <= vh - EDGE || r.top - GAP - h < EDGE ? r.bottom + GAP : r.top - GAP - h;
    el.style.left = `${x + window.scrollX}px`;
    el.style.top = `${y + window.scrollY}px`;
  }

  const outside = e => { if (e.target instanceof Node && !el.contains(e.target)) close(); };
  function close() {
    if (current?.el !== el) return;
    current = null;
    document.removeEventListener('mousedown', outside, true);
    window.removeEventListener('resize', close);
    el.remove();
  }
  const choose = date => { close(); onPick(date); };

  // A press in the calendar must not take the caret out of anything, nor
  // reach the page under it.
  el.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); });
  el.addEventListener('click', e => {
    e.stopPropagation();
    const t = e.target instanceof Element ? e.target : null;
    const day = t?.closest('.mb-kb-cal__day');
    if (day) { choose(day.dataset.date); return; }
    if (t === prev) show(shiftDate(iso(year, month, 1), { months: -1 }), false);
    else if (t === next) show(shiftDate(iso(year, month, 1), { months: 1 }), false);
    else if (t === todayBtn) choose(today);
    else if (t === clearBtn) choose('');
  });
  el.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
      if (anchor.isConnected) anchor.focus?.({ preventScroll: true });
      return;
    }
    if (!(e.target instanceof Element) || !e.target.matches('.mb-kb-cal__day')) return;
    const step = {
      ArrowLeft: { days: -1 }, ArrowRight: { days: 1 }, ArrowUp: { days: -7 }, ArrowDown: { days: 7 },
      PageUp: { months: -1 }, PageDown: { months: 1 },
    }[e.key];
    if (!step) return;
    e.preventDefault();
    e.stopPropagation();
    show(shiftDate(e.target.dataset.date, step));
  });

  document.body.append(el);
  current = { el, close };
  draw();
  place();
  grid.querySelector(`[data-date="${focus}"]`)?.focus({ preventScroll: true });
  // From the next turn on: the click that opened it is still on its way up.
  setTimeout(() => {
    if (current?.el !== el) return;
    document.addEventListener('mousedown', outside, true);
    window.addEventListener('resize', close);
  }, 0);
  return { el, close };
}
