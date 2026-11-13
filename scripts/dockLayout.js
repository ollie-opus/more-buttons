// Pure ordering logic for the button dock (no DOM, no chrome.*).

// Group names with a fixed place at the end of the dock. All three ignore
// dockOrder for group placement: Uncategorised (the bucket for buttons with a
// blank/missing dockGroup) sits after every named group, Actions (the saved
// actions, offered on every page) after that, and System last —
// [named groups…][Uncategorised][Actions][System].
export const UNCATEGORISED_GROUP = 'Uncategorised';
export const ACTIONS_GROUP = 'Actions';
export const SYSTEM_GROUP = 'System';
const TAIL_GROUPS = [UNCATEGORISED_GROUP, ACTIONS_GROUP, SYSTEM_GROUP];

// Reserved groups are the two fixed buckets, Uncategorised and System. Surfaces
// use this to skip the "Group: " prefix on the compact hover tag, which only
// earns its place for named groups. Actions is pinned to the tail but is still
// a named group, so it keeps its prefix.
export function isReservedGroup(name) {
  return name === UNCATEGORISED_GROUP || name === SYSTEM_GROUP;
}

// Always returns a non-empty group name: blank/whitespace/missing → Uncategorised.
export function normaliseGroup(g) {
  if (typeof g !== 'string') return UNCATEGORISED_GROUP;
  const t = g.trim();
  return t === '' ? UNCATEGORISED_GROUP : t;
}

// surface: 'page' (default) | 'popup' | 'both'
export function splitBySurface(buttons) {
  const page = [];
  const popup = [];
  for (const btn of buttons) {
    const surface = btn.surface ?? 'page';
    if (surface === 'page' || surface === 'both') page.push(btn);
    if (surface === 'popup' || surface === 'both') popup.push(btn);
  }
  return { page, popup };
}

const byOrderThenIdx = (a, b) => (a.order === b.order ? a.idx - b.idx : a.order < b.order ? -1 : 1);

export function orderDockButtons(buttons) {
  const buckets = new Map();
  buttons.forEach((btn, idx) => {
    const order = Number.isFinite(btn.dockOrder) ? btn.dockOrder : Infinity;
    const group = normaliseGroup(btn.dockGroup);
    if (!buckets.has(group)) buckets.set(group, []);
    buckets.get(group).push({ btn, idx, order });
  });
  for (const items of buckets.values()) items.sort(byOrderThenIdx);
  const named = [...buckets.entries()]
    .filter(([g]) => !TAIL_GROUPS.includes(g))
    .map(([, items]) => items)
    .sort((a, b) => byOrderThenIdx(
      { order: a[0].order, idx: Math.min(...a.map((d) => d.idx)) },
      { order: b[0].order, idx: Math.min(...b.map((d) => d.idx)) }));
  for (const g of TAIL_GROUPS) if (buckets.has(g)) named.push(buckets.get(g));
  return named.map((items) => items.map((d) => d.btn));
}
