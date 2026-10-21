// Pure ordering logic for the button dock (no DOM, no chrome.*).

export function normaliseGroup(g) {
  if (typeof g !== 'string') return null;
  const t = g.trim();
  return t === '' ? null : t;
}

export function splitBySurface(buttons) {
  const page = [];
  const popup = [];
  for (const btn of buttons) {
    ((btn.surface ?? 'page') === 'popup' ? popup : page).push(btn);
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
    .filter(([g]) => g !== null)
    .map(([, items]) => items)
    .sort((a, b) => byOrderThenIdx(
      { order: a[0].order, idx: Math.min(...a.map((d) => d.idx)) },
      { order: b[0].order, idx: Math.min(...b.map((d) => d.idx)) }));
  if (buckets.has(null)) named.push(buckets.get(null));
  return named.map((items) => items.map((d) => d.btn));
}
