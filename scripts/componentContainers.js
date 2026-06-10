/**
 * componentContainers.js — tiny leaf registry decoupling the capture flows
 * (captures.js) and the edit-capture form (captureComponent.js) from the
 * editors that own markdown serialization (guides.js, later systemUpdates.js).
 *
 * A "container" is a thing whose body holds an ordered component list — a guide
 * section, a guide admonition, etc. Each editor registers a handler per kind:
 *
 *   registerComponentContainer('guide-section', {
 *     readComponents: (md, uuid) => ({ description, components }),
 *     writeBody: (md, uuid, description, components) => newMd,
 *     exists: (md, uuid) => boolean,
 *     mutate: async (container, transform, onProgress) => { … commit + re-render … },
 *   })
 *
 * `mutate(uuid, transform, onProgress)` reads the container's current component
 * list, runs `transform(components)` → new components, persists the rebuilt body,
 * and re-renders the open editor. Keeping this behind a registry means captures
 * never import the editors (which would cycle, since editors import captures).
 */

const registry = {};

export function registerComponentContainer(kind, handlers) {
  registry[kind] = handlers;
}

export function getComponentContainer(kind) {
  return registry[kind] ?? null;
}

/**
 * True when the container identified by `{ kind, uuid }` is still present in
 * `md`. Distinct from "container exists but is empty": the per-kind
 * readComponents helpers return `{ description:'', components:[] }` for BOTH
 * a vanished container and a genuinely empty one, so insert flows must check
 * this first to fail loudly instead of writing into nothing (the per-kind
 * writeBody helpers return `md` unchanged when the uuid isn't found).
 * Unregistered kinds report false.
 */
export function containerExists(md, container) {
  return !!getComponentContainer(container.kind)?.exists(md, container.uuid);
}
