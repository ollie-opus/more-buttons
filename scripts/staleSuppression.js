// A keyed bag of suppression sets. Each key is a logical entity name
// (e.g. 'systemUpdateDrafts'). Values are Sets of identifiers (UUIDs)
// that should be hidden from rendered lists until a fresh fetch confirms
// they are gone — covers GitHub contents-API eventual consistency.

const sets = new Map();

function setFor(entity) {
  let s = sets.get(entity);
  if (!s) { s = new Set(); sets.set(entity, s); }
  return s;
}

export function suppress(entity, id) {
  if (!id) return;
  setFor(entity).add(id);
}

export function isSuppressed(entity, id) {
  return setFor(entity).has(id);
}

// Any id in the set that is NOT in the freshly-fetched id list is
// considered confirmed-gone and removed from the set.
export function reconcile(entity, freshIds) {
  const s = setFor(entity);
  const fresh = freshIds instanceof Set ? freshIds : new Set(freshIds);
  for (const id of s) {
    if (!fresh.has(id)) s.delete(id);
  }
}

export function filterSuppressed(entity, items, idOf = x => x.uuid) {
  const s = setFor(entity);
  return items.filter(item => {
    const id = idOf(item);
    return !id || !s.has(id);
  });
}
