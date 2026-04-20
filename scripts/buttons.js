const FONT_FAMILY = "RubikVariable, ui-sans-serif, system-ui, sans-serif, Apple Color Emoji, Segoe UI Emoji, Segoe UI Symbol, Noto Color Emoji";

function resolveColor(color, isDark) {
  if (!color || typeof color === 'string') return color;
  return isDark ? (color.dark ?? color.light) : (color.light ?? color.dark);
}

function isDarkMode() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function createSegmentElement(segDef, parentDef, dispatchFn) {
  const btn = document.createElement("button");
  btn.id = segDef.id;
  btn.className = "more-buttons-page-btn";
  btn.title = segDef.hoverText || "";

  const rawFill   = segDef.fillColor || parentDef.fillColor || "#eee";
  const rawText   = segDef.textColor || parentDef.textColor || "#000";
  const rawBorder = segDef.border    || parentDef.border    || "none";

  const applyColors = (isDark) => {
    btn.style.backgroundColor = resolveColor(rawFill, isDark);
    btn.style.color            = resolveColor(rawText, isDark);
    btn.style.border           = resolveColor(rawBorder, isDark);
  };
  applyColors(isDarkMode());

  if ([rawFill, rawText, rawBorder].some(v => typeof v === 'object')) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => applyColors(e.matches));
  }
  btn.style.margin = "0";
  btn.style.borderRadius = "0";
  btn.style.display = "flex";
  btn.style.alignItems = "center";
  btn.style.justifyContent = "center";
  btn.style.gap = "6px";
  btn.style.cursor = "pointer";
  btn.style.pointerEvents = "auto";
  btn.style.fontWeight = "500";
  btn.style.fontFamily = FONT_FAMILY;
  btn.style.fontSize = ".875rem";

  btn.addEventListener("mouseenter", () => { btn.style.filter = "brightness(1.08)"; });
  btn.addEventListener("mouseleave", () => { btn.style.filter = ""; });

  if (segDef.icon) {
    const iconEl = document.createElement("span");
    iconEl.className = "material-symbols-outlined";
    iconEl.textContent = segDef.icon;
    iconEl.style.fontSize = "18px";
    iconEl.style.verticalAlign = "middle";
    iconEl.style.fontVariationSettings = "'FILL' 1";
    btn.appendChild(iconEl);
  }

  if (segDef.displayText?.trim()) {
    const textEl = document.createElement("span");
    textEl.textContent = segDef.displayText;
    btn.appendChild(textEl);
    btn.style.padding = "9px 13px";
  } else {
    btn.style.padding = "10.5px 10.5px";
  }

  if (segDef.action) {
    btn.addEventListener("click", () => dispatchFn(segDef.action));
  }

  return btn;
}

function createButtonElement(def, dispatchFn) {
  const btn = createSegmentElement(def, def, dispatchFn);
  btn.style.margin = "4px";
  btn.style.borderRadius = "3px";
  btn.style.boxShadow = "0 2px 6px rgba(0,0,0,0.15)";
  btn.style.transition = "box-shadow 0.2s ease, background-color 0.2s ease";
  btn.addEventListener("mouseenter", () => { btn.style.boxShadow = "0 4px 12px rgba(0,0,0,0.3)"; });
  btn.addEventListener("mouseleave", () => { btn.style.boxShadow = "0 2px 6px rgba(0,0,0,0.15)"; });
  return btn;
}

function createSplitGroupElement(def, dispatchFn) {
  const wrapper = document.createElement("div");
  wrapper.id = def.id;
  wrapper.style.display = "flex";
  wrapper.style.margin = "4px";
  wrapper.style.borderRadius = "3px";
  wrapper.style.boxShadow = "0 2px 6px rgba(0,0,0,0.15)";
  wrapper.style.transition = "box-shadow 0.2s ease";
  wrapper.style.pointerEvents = "auto";
  const rawWrapFill   = def.fillColor || "#6b7280";
  const rawWrapBorder = def.border || null;

  const applyWrapperColors = (isDark) => {
    wrapper.style.backgroundColor = resolveColor(rawWrapFill, isDark);
    if (rawWrapBorder) wrapper.style.border = resolveColor(rawWrapBorder, isDark);
  };
  applyWrapperColors(isDarkMode());

  if ([rawWrapFill, rawWrapBorder].some(v => typeof v === 'object')) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => applyWrapperColors(e.matches));
  }

  wrapper.addEventListener("mouseenter", () => { wrapper.style.boxShadow = "0 4px 12px rgba(0,0,0,0.3)"; });
  wrapper.addEventListener("mouseleave", () => { wrapper.style.boxShadow = "0 2px 6px rgba(0,0,0,0.15)"; });

  const segments = [
    { ...def, id: def.id + "-main", border: undefined },
    ...def.splitWith.map(seg => ({ fillColor: def.fillColor, textColor: def.textColor, ...seg, border: undefined })),
  ];

  segments.forEach((seg, i) => {
    if (i > 0) {
      const divider = document.createElement("div");
      divider.style.width = "1px";
      divider.style.background = "rgba(0,0,0,0.25)";
      divider.style.alignSelf = "stretch";
      divider.style.flexShrink = "0";
      wrapper.appendChild(divider);
    }
    const segEl = createSegmentElement(seg, { ...def, border: "none" }, dispatchFn);
    if (i === 0) { segEl.style.borderTopLeftRadius = "2px"; segEl.style.borderBottomLeftRadius = "2px"; }
    if (i === segments.length - 1) { segEl.style.borderTopRightRadius = "2px"; segEl.style.borderBottomRightRadius = "2px"; }
    wrapper.appendChild(segEl);
  });

  return wrapper;
}

export function createButton(def, dispatchFn) {
  return def.splitWith?.length
    ? createSplitGroupElement(def, dispatchFn)
    : createButtonElement(def, dispatchFn);
}
