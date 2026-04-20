export async function attachColorPresetPills(root = document) {
  let presets;
  try {
    const resp = await fetch(chrome.runtime.getURL('config/labelColours.json'));
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    presets = await resp.json();
  } catch (err) {
    console.error('MB Error: Failed to load labelColours.json:', err);
    return;
  }

  const pillClasses = "inline-flex items-center px-1.5 py-1 rounded-full text-xs max-w-full font-medium font-mono transition-all duration-200 ease-out truncate bg-[--bg] text-[--text] border-[--border] border dark:bg-[--bg-dark] dark:text-[--text-dark] dark:border-[--border-dark]";

  function deepEqual(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  function attach(scope) {
    scope.querySelectorAll("label").forEach(label => {
      const text = label.textContent.trim().toLowerCase();
      if (text !== "colors" && text !== "colours") return;

      const container = label.closest(".sm\\:col-span-5");
      if (!container) return;

      const textarea = container.querySelector("textarea[data-controller='autosize']");
      if (!textarea || textarea.dataset.pillsAttached) return;
      textarea.dataset.pillsAttached = "true";

      const wrapper = document.createElement("div");
      wrapper.className = "rounded-lg bg-black/[.03] dark:bg-white/[.04] border border-black/[.07] dark:border-white/[.08]";
      wrapper.style.cssText = "margin-top:8px;display:flex;flex-direction:column;gap:8px;padding:10px 12px;";

      const buttons = [];

      function clearSelection() {
        buttons.forEach(b => {
          b.style.outline = "";
          b.style.outlineOffset = "";
          b.style.fontWeight = "500";
        });
      }

      function selectButton(btn) {
        clearSelection();
        btn.style.fontWeight = "600";
        btn.style.outline = "2px solid currentColor";
        btn.style.outlineOffset = "2px";
      }

      function createPresetButton(name, preset) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = pillClasses;
        btn.textContent = name;
        btn.dataset.presetName = name;

        btn.style.setProperty("--bg", preset.light.bg);
        btn.style.setProperty("--text", preset.light.text);
        btn.style.setProperty("--border", preset.light.border);
        btn.style.setProperty("--bg-dark", preset.dark.bg);
        btn.style.setProperty("--text-dark", preset.dark.text);
        btn.style.setProperty("--border-dark", preset.dark.border);

        btn.addEventListener("click", () => {
          textarea.value = JSON.stringify(preset, null, 2);
          textarea.dispatchEvent(new Event("input", { bubbles: true }));
          textarea.dispatchEvent(new Event("change", { bubbles: true }));
          selectButton(btn);
        });

        buttons.push(btn);
        return btn;
      }

      const flatPresets = {};
      for (const groupPresets of Object.values(presets)) {
        Object.assign(flatPresets, groupPresets);
      }

      for (const [groupName, groupPresets] of Object.entries(presets)) {
        const title = document.createElement("span");
        title.textContent = groupName;
        title.className = "text-gray-500 dark:text-gray-400";
        title.style.cssText = "display:block;width:100%;font-size:10px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;margin-bottom:2px;";

        const pillRow = document.createElement("div");
        pillRow.style.cssText = "display:flex;flex-wrap:wrap;gap:6px;";

        for (const [name, preset] of Object.entries(groupPresets)) {
          pillRow.appendChild(createPresetButton(name, preset));
        }

        wrapper.appendChild(title);
        wrapper.appendChild(pillRow);
      }

      textarea.insertAdjacentElement("afterend", wrapper);

      try {
        const current = JSON.parse(textarea.value);
        for (const btn of buttons) {
          const name = btn.dataset.presetName;
          if (deepEqual(current, flatPresets[name])) {
            selectButton(btn);
            break;
          }
        }
      } catch {}
    });
  }

  attach(root);

  const observer = new MutationObserver(mutations => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType === 1) attach(node);
      }
    }
  });

  observer.observe(root.body ?? root, { childList: true, subtree: true });

  return observer;
}
