/**
 * formMerge.js — pure three-way field merge for markdown-backed forms.
 *
 * For each field we compare three values:
 *   snap  — baseline captured at form-open (formEl._initialSnapshot[name])
 *   cur   — the user's current form value (readFormValues(formEl)[name])
 *   fresh — the value parsed out of the freshly re-fetched markdown
 *
 * No DOM, no network — kept pure so it is fully unit-testable.
 */

/** Thrown by a save builder when unresolved conflicts need user input. */
export class ConflictNeeded extends Error {
  constructor(conflicts) {
    super('Merge conflict requires resolution');
    this.name = 'ConflictNeeded';
    this.conflicts = conflicts;
  }
}

function scalarEqual(a, b) {
  return a === b;
}

/**
 * @param {Object} snap  - baseline field values
 * @param {Object} cur   - current form field values
 * @param {Object} fresh - field values parsed from fresh markdown
 * @param {Array<{name:string,type:string,label:string}>} fieldSpecs
 * @param {Object} [resolutions] - { [field]: { choice:'mine'|'theirs', theirsShown } }
 * @returns {{ resolved: Object, conflicts: Array<{field,label,mine,theirs}> }}
 */
export function mergeFields(snap = {}, cur = {}, fresh = {}, fieldSpecs = [], resolutions = {}) {
  const resolved = {};
  const conflicts = [];

  for (const spec of fieldSpecs) {
    if (spec.type === 'orderedUuidList') {
      mergeOrderedUuidList(spec, snap, cur, fresh, resolutions, resolved, conflicts);
      continue;
    }
    mergeScalar(spec, snap, cur, fresh, resolutions, resolved, conflicts);
  }

  return { resolved, conflicts };
}

function mergeScalar(spec, snap, cur, fresh, resolutions, resolved, conflicts) {
  const { name, label } = spec;
  const s = snap[name];
  const c = cur[name];
  const f = fresh[name];

  if (scalarEqual(c, s)) { resolved[name] = f; return; }   // untouched → theirs
  if (scalarEqual(f, s)) { resolved[name] = c; return; }   // only you → yours
  if (scalarEqual(f, c)) { resolved[name] = c; return; }   // same edit → fine

  // true collision — honour a recorded choice only if theirs hasn't moved since.
  const r = resolutions[name];
  if (r && scalarEqual(f, r.theirsShown)) {
    resolved[name] = r.choice === 'mine' ? c : f;
    return;
  }
  conflicts.push({ field: name, label, mine: c, theirs: f });
}

const splitUuids = v => String(v ?? '').split(',').filter(Boolean);
const arraysEqual = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * `mergeMine` = your order, filtered to fresh membership, with fresh-new UUIDs
 * inserted after their surviving fresh-predecessors.
 */
function mergeMine(B, F) {
  const freshSet = new Set(F), bSet = new Set(B);
  const out = B.filter(u => freshSet.has(u)); // your order, deletions dropped
  F.forEach((u, i) => {
    if (bSet.has(u)) return; // not new
    // Insert after the nearest fresh-predecessor that already survives in `out`.
    let insertAt = 0; // default: no surviving fresh-predecessor → insert at the head
    for (let j = i - 1; j >= 0; j--) {
      const idx = out.indexOf(F[j]);
      if (idx !== -1) { insertAt = idx + 1; break; }
    }
    out.splice(insertAt, 0, u);
  });
  return out;
}

function commonOrder(order, otherSet) {
  return order.filter(u => otherSet.has(u));
}

function mergeOrderedUuidList(spec, snap, cur, fresh, resolutions, resolved, conflicts) {
  const { name, label } = spec;
  const A = splitUuids(snap[name]), B = splitUuids(cur[name]), F = splitUuids(fresh[name]);
  const snapSet = new Set(A), freshSet = new Set(F);

  const youReordered = !arraysEqual(A, B);
  const theyReordered = !arraysEqual(commonOrder(A, freshSet), commonOrder(F, snapSet));

  if (!youReordered) { resolved[name] = F.join(','); return; }

  const mine = mergeMine(B, F);
  if (!theyReordered || arraysEqual(mine, F)) { resolved[name] = mine.join(','); return; }

  // Both reordered differently → conflict.
  const r = resolutions[name];
  if (r && arraysEqual(F, splitUuids((r.theirsShown ?? []).join(',')))) {
    resolved[name] = (r.choice === 'mine' ? mine : F).join(',');
    return;
  }
  conflicts.push({ field: name, label, mine, theirs: F });
}
