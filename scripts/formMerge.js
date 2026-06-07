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
    const { name, label } = spec;
    const s = snap[name];
    const c = cur[name];
    const f = fresh[name];

    if (scalarEqual(c, s)) { resolved[name] = f; continue; }   // untouched → theirs
    if (scalarEqual(f, s)) { resolved[name] = c; continue; }   // only you → yours
    if (scalarEqual(f, c)) { resolved[name] = c; continue; }   // same edit → fine

    // true collision — honour a recorded choice only if theirs hasn't moved since.
    const r = resolutions[name];
    if (r && scalarEqual(f, r.theirsShown)) {
      resolved[name] = r.choice === 'mine' ? c : f;
      continue;
    }
    conflicts.push({ field: name, label, mine: c, theirs: f });
  }

  return { resolved, conflicts };
}
