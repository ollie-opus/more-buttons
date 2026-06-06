/**
 * componentContainers.js — tiny leaf registry decoupling the capture flows
 * (captures.js) and the edit-capture form (captureComponent.js) from the
 * editors that own markdown serialization (guides.js, later systemUpdates.js).
 *
 * A "container" is a thing whose body holds an ordered component list — a guide
 * section, a guide admonition, etc. Each editor registers a handler per kind:
 *
 *   registerComponentContainer('guide-section', {
 *     mutate: async (uuid, transform, onProgress) => { … commit + re-render … },
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
