/**
 * actionsLibrary.js — the saved Actions library in chrome.storage.local.
 *
 *   moreButtonsActions = { version: 1, activeId: string|null, actions: [Action] }
 *   Action = { id, name, createdAt, updatedAt, steps: [Step] }   (Step: actionSteps.js)
 *
 * One Action is "active": the one the dock's Play button runs. The pure
 * reducers below (normalise/upsert/remove/withActive) carry all the rules and
 * are unit-tested; the async wrappers at the bottom are the only chrome.*
 * touch points. No chrome access at module scope.
 */

import { STEP_KINDS } from './actionSteps.js';

export const STORAGE_KEY = 'moreButtonsActions';

export const emptyLibrary = () => ({ version: 1, activeId: null, actions: [] });

const defaultId = () => (globalThis.crypto?.randomUUID?.() ?? `a-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);

function normaliseStep(raw) {
  if (!raw || typeof raw !== 'object' || !STEP_KINDS.includes(raw.kind) || !raw.id) return null;
  return {
    id: String(raw.id),
    kind: raw.kind,
    locator: raw.locator && typeof raw.locator === 'object' ? raw.locator : null,
    describe: { label: '', tag: null, type: null, ...(raw.describe && typeof raw.describe === 'object' ? raw.describe : {}) },
    value: raw.value ?? null,
    askAtPlay: raw.askAtPlay === true,
  };
}

function normaliseAction(raw) {
  if (!raw || typeof raw !== 'object' || !raw.id) return null;
  const steps = Array.isArray(raw.steps) ? raw.steps.map(normaliseStep).filter(Boolean) : [];
  return {
    id: String(raw.id),
    name: String(raw.name ?? '').trim() || 'Untitled action',
    createdAt: Number(raw.createdAt) || 0,
    updatedAt: Number(raw.updatedAt) || 0,
    steps,
  };
}

/** Anything from storage → a well-formed library. A dangling activeId is cleared. */
export function normaliseLibrary(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !Array.isArray(raw.actions)) return emptyLibrary();
  const actions = raw.actions.map(normaliseAction).filter(Boolean);
  const activeId = typeof raw.activeId === 'string' && actions.some(a => a.id === raw.activeId) ? raw.activeId : null;
  return { version: 1, activeId, actions };
}

export function newAction({ name, steps }, now = Date.now(), newId = defaultId) {
  return { id: newId(), name: String(name ?? '').trim(), createdAt: now, updatedAt: now, steps: Array.isArray(steps) ? steps : [] };
}

/** Insert or replace by id. The first action ever saved becomes active. */
export function upsertInto(lib, action, now = Date.now()) {
  const next = { ...action, updatedAt: now };
  const i = lib.actions.findIndex(a => a.id === action.id);
  const actions = i === -1 ? [...lib.actions, next] : lib.actions.map((a, j) => (j === i ? next : a));
  const activeId = lib.actions.length === 0 ? next.id : lib.activeId;
  return { ...lib, actions, activeId };
}

export function removeFrom(lib, id) {
  if (!lib.actions.some(a => a.id === id)) return lib;
  return { ...lib, actions: lib.actions.filter(a => a.id !== id), activeId: lib.activeId === id ? null : lib.activeId };
}

/** Set the active action (null = none). Unknown ids leave the library untouched. */
export function withActive(lib, id) {
  if (id !== null && !lib.actions.some(a => a.id === id)) return lib;
  return { ...lib, activeId: id };
}

// ── chrome.storage.local wrappers ─────────────────────────────────────────────

export async function loadLibrary() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return normaliseLibrary(stored?.[STORAGE_KEY]);
}

export async function saveLibrary(lib) {
  await chrome.storage.local.set({ [STORAGE_KEY]: normaliseLibrary(lib) });
  return lib;
}

export async function upsertAction(action) {
  return saveLibrary(upsertInto(await loadLibrary(), action));
}

export async function removeAction(id) {
  return saveLibrary(removeFrom(await loadLibrary(), id));
}

export async function setActiveAction(id) {
  return saveLibrary(withActive(await loadLibrary(), id));
}

export async function getActiveAction() {
  const lib = await loadLibrary();
  return lib.actions.find(a => a.id === lib.activeId) ?? null;
}
