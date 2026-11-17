/**
 * kbToc.js — the theme's "On this page" list, kept in step with the in-page
 * editor (kbPageEditor.js).
 *
 * The site builds that list from the draft as it was last built, so it knows
 * nothing of a heading added, renamed, moved or deleted since. The editor draws
 * the whole article itself, so the list is drawn again from the headings the
 * article holds now (whatever is showing: the draft, the live content, or the
 * Markdown view's title alone), in the theme's own markup, each time they
 * change. The theme's own scroll tracking only knows the links it was built
 * with, so marking the one being read is done here too.
 *
 * tocTree and tocHtml are pure and Node-tested; attachToc needs a DOM.
 */

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * The headings under the title, nested by level as the theme nests them (a
 * level skipped is nested under the nearest one above it).
 *
 * @param {{level: number, text: string, id: string, uuid?: string}[]} headings - in page order, H1 included or not
 * @returns {{level: number, text: string, id: string, uuid?: string, children: object[]}[]}
 */
export function tocTree(headings) {
  const root = { level: 1, children: [] };
  const stack = [root];
  for (const h of headings) {
    if (!(h.level > 1)) continue; // the title is the page's, not the list's
    while (stack.length > 1 && stack[stack.length - 1].level >= h.level) stack.pop();
    const item = { ...h, children: [] };
    stack[stack.length - 1].children.push(item);
    stack.push(item);
  }
  return root.children;
}

/** The theme's `<li>` markup for a tree from tocTree. */
export function tocHtml(items) {
  return items.map(item => {
    const kids = item.children.length
      ? `<nav class="md-nav" aria-label="${esc(item.text)}"><ul class="md-nav__list">${tocHtml(item.children)}</ul></nav>`
      : '';
    return `<li class="md-nav__item"><a href="#${esc(item.id)}" class="md-nav__link" data-mb-toc="${esc(item.uuid ?? '')}">`
      + `<span class="md-ellipsis"><span class="md-typeset">${esc(item.text)}</span></span></a>${kids}</li>`;
  }).join('');
}

const HEADINGS = ':scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > h5, :scope > h6';

function headingsOf(article) {
  return [...article.querySelectorAll(HEADINGS)].map(h => ({
    level: Number(h.tagName[1]),
    text: (h.textContent ?? '').replace(/\s+/g, ' ').trim(),
    id: h.id,
    uuid: h.dataset.mbNode,
    el: h,
  }));
}

// The theme's list, or one made in its place when the site built the page
// with no headings under the title (it leaves the list out then).
function listOf(sidebar) {
  let nav = sidebar.querySelector('.md-nav--secondary');
  if (!nav) {
    const inner = sidebar.querySelector('.md-sidebar__inner');
    if (!inner) return null;
    inner.insertAdjacentHTML('beforeend', '<nav class="md-nav md-nav--secondary" aria-label="On this page"><label class="md-nav__title" for="__toc"><span class="md-nav__icon md-icon"></span>On this page</label></nav>');
    nav = inner.lastElementChild;
  }
  let list = nav.querySelector(':scope > ul.md-nav__list');
  if (!list) {
    nav.insertAdjacentHTML('beforeend', '<ul class="md-nav__list" data-md-component="toc" data-md-scrollfix></ul>');
    list = nav.lastElementChild;
  }
  return { nav, list };
}

const headerBottom = () => document.querySelector('.md-header')?.getBoundingClientRect().bottom ?? 0;

/**
 * Keep the sidebar's list drawn from `article`'s headings.
 *
 * @param {HTMLElement} article
 * @param {{ hidden?: () => boolean }} [opts] - `hidden`: the page's settings hide the list (`hide: [toc]`)
 * @returns {{ refresh: () => void }} refresh: draw again now (a settings change, say)
 */
export function attachToc(article, { hidden = () => false } = {}) {
  const sidebar = document.querySelector('.md-sidebar--secondary');
  const parts = sidebar ? listOf(sidebar) : null;
  if (!sidebar || !parts) return { refresh() {} };
  const { nav, list } = parts;
  let drawn = null; // what the list was last drawn from
  let shown = [];
  let queued = 0;

  function markActive() {
    const line = headerBottom() + 12;
    let on = null;
    for (const h of shown) if (h.el.isConnected && h.el.getBoundingClientRect().top <= line) on = h.uuid ?? h.id;
    if (on == null && shown.length) on = shown[0].uuid ?? shown[0].id;
    list.querySelectorAll('a.md-nav__link').forEach((a, i) => {
      a.classList.toggle('md-nav__link--active', (shown[i].uuid ?? shown[i].id) === on);
    });
  }

  function draw() {
    queued = 0;
    const off = hidden();
    if (sidebar.hidden !== off) sidebar.hidden = off;
    const all = headingsOf(article);
    const key = off ? '' : JSON.stringify(all.map(h => [h.level, h.text, h.id, h.uuid]));
    if (key !== drawn) {
      drawn = key;
      const tree = off ? [] : tocTree(all);
      list.innerHTML = tocHtml(tree);
      nav.hidden = !tree.length;
      // In list order, which is page order without the title.
      shown = all.filter(h => h.level > 1);
    } else {
      shown = all.filter(h => h.level > 1); // same headings, perhaps new elements
    }
    markActive();
  }
  const queue = () => { if (!queued) queued = requestAnimationFrame(draw); };

  new MutationObserver(queue).observe(article, { childList: true, subtree: true, characterData: true });
  window.addEventListener('scroll', () => requestAnimationFrame(markActive), { passive: true });

  // A link goes to its heading as drawn now (two headings may share a name,
  // and the theme's own handling knows only the page as it was built).
  list.addEventListener('click', e => {
    const a = e.target instanceof Element ? e.target.closest('a.md-nav__link') : null;
    if (!a) return;
    const i = [...list.querySelectorAll('a.md-nav__link')].indexOf(a);
    const h = shown[i]?.el;
    if (!h?.isConnected) return;
    e.preventDefault();
    e.stopPropagation();
    const top = h.getBoundingClientRect().top + window.scrollY - headerBottom() - 8;
    window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    // On a narrow window the list is a drawer: close it.
    const toggle = document.getElementById('__toc');
    if (toggle instanceof HTMLInputElement) toggle.checked = false;
  }, true);

  draw();
  return { refresh: draw };
}
