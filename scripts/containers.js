export function createContainer(container) {
  const el = document.createElement("div");
  el.id = container.id;

  el.style.position = container.position || "fixed";
  if (container.top !== undefined) el.style.top = container.top;
  if (container.right !== undefined) el.style.right = container.right;
  if (container.bottom !== undefined) el.style.bottom = container.bottom;
  if (container.left !== undefined) el.style.left = container.left;
  if (container.transform !== undefined) el.style.transform = container.transform;
  if (container.width !== undefined) el.style.width = container.width;
  if (container.height !== undefined) el.style.height = container.height;
  if (container.backgroundColor !== undefined) el.style.backgroundColor = container.backgroundColor;
  if (container.padding !== undefined) el.style.padding = container.padding;
  if (container.border !== undefined) el.style.border = container.border;
  if (container.borderRadius !== undefined) el.style.borderRadius = container.borderRadius;
  if (container.pointerEvents !== undefined) el.style.pointerEvents = container.pointerEvents;
  if (container.zIndex !== undefined) el.style.zIndex = container.zIndex;

  if (container.flexDirection) {
    el.style.flexDirection = container.flexDirection;
    el.style.alignItems = container.alignItems || "flex-start";
    el.style.gap = container.gap || "0px";
  }

  if (container.relative) {
    el.dataset.relativeToId    = container.relative.toId || "";
    el.dataset.relativeOffsetX = String(container.relative.offsetX || 0);
    el.dataset.relativeOffsetY = String(container.relative.offsetY || 0);
  }

  const displayWhenShown = container.display ?? (container.flexDirection ? "flex" : "");
  el.dataset.displayWhenShown = displayWhenShown;

  if (container.hidden) {
    el.style.display = "none";
    el.dataset.mbHidden = "true";
  } else {
    if (displayWhenShown) el.style.display = displayWhenShown;
    el.dataset.mbHidden = "false";
  }

  function positionOnce() {
    const toId = el.dataset.relativeToId;
    if (!toId) return;
    const anchor = document.getElementById(toId);
    if (!anchor) return;

    const offX = parseFloat(el.dataset.relativeOffsetX || "0") || 0;
    const offY = parseFloat(el.dataset.relativeOffsetY || "0") || 0;

    let isFixed = false, n = anchor;
    while (n && n !== document.documentElement) {
      if (getComputedStyle(n).position === "fixed") { isFixed = true; break; }
      n = n.parentElement;
    }

    const rect = anchor.getBoundingClientRect();
    const scrollX = isFixed ? 0 : (window.scrollX || document.documentElement.scrollLeft || 0);
    const scrollY = isFixed ? 0 : (window.scrollY || document.documentElement.scrollTop  || 0);

    el.style.position = isFixed ? "fixed" : "absolute";
    el.style.left = `${rect.left + scrollX + offX}px`;
    el.style.top  = `${rect.bottom + scrollY + offY}px`;
  }

  el.__mbPositionOnce = positionOnce;

  el.__mbToggleVisibility = function () {
    const isHidden = getComputedStyle(el).display === "none";
    if (isHidden) {
      if (el.dataset.relativeToId) positionOnce();
      const d = el.dataset.displayWhenShown || "";
      el.style.display = d;
      el.dataset.mbHidden = "false";
    } else {
      el.style.display = "none";
      el.dataset.mbHidden = "true";
    }
  };

  el.classList.add("more-buttons-container");
  return el;
}
