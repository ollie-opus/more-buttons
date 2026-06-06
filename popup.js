function createToggleButton(button, { resolveColor, isDarkMode }) {
  const btn = document.createElement("button");
  btn.id = button.id;
  btn.title = button.hoverText || "";

  const rawBtnFill   = button.fillColor || "#6b7280";
  const rawBtnText   = button.textColor || "white";
  const rawBtnBorder = button.border    || "none";
  btn.style.backgroundColor = resolveColor(rawBtnFill, isDarkMode());
  btn.style.color            = resolveColor(rawBtnText, isDarkMode());
  btn.style.border           = resolveColor(rawBtnBorder, isDarkMode());

  if ([rawBtnFill, rawBtnText, rawBtnBorder].some(v => typeof v === 'object')) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
      btn.style.backgroundColor = resolveColor(rawBtnFill, e.matches);
      btn.style.color            = resolveColor(rawBtnText, e.matches);
      btn.style.border           = resolveColor(rawBtnBorder, e.matches);
    });
  }
  btn.style.margin = "4px";
  btn.style.borderRadius = "3px";
  btn.style.display = "flex";
  btn.style.alignItems = "center";
  btn.style.justifyContent = "center";
  btn.style.gap = "6px";
  btn.style.cursor = "pointer";
  btn.style.fontWeight = "500";
  btn.style.fontFamily = "RubikVariable, ui-sans-serif, system-ui, sans-serif";
  btn.style.fontSize = ".875rem";
  btn.style.boxShadow = "0 2px 6px rgba(0,0,0,0.15)";
  btn.style.transition = "box-shadow 0.2s ease, background-color 0.5s ease-in-out";

  btn.addEventListener("mouseenter", () => {
    btn.style.boxShadow = "0 4px 12px rgba(0,0,0,0.3)";
    btn.style.filter = "brightness(1.05)";
  });
  btn.addEventListener("mouseleave", () => {
    btn.style.boxShadow = "0 2px 6px rgba(0,0,0,0.15)";
    btn.style.filter = "brightness(1)";
  });

  const { iconOn, iconOff } = button.toggle;
  const iconContainer = document.createElement("span");
  iconContainer.style.position = "relative";
  iconContainer.style.width = "18px";
  iconContainer.style.height = "18px";

  const makeIcon = (name) => {
    const el = document.createElement("span");
    el.className = "material-symbols-outlined";
    el.textContent = name;
    el.style.position = "absolute";
    el.style.top = "0";
    el.style.left = "0";
    el.style.fontSize = "18px";
    return el;
  };

  const iconOffEl = makeIcon(iconOff);
  const iconOnEl = makeIcon(iconOn);
  iconContainer.appendChild(iconOffEl);
  iconContainer.appendChild(iconOnEl);
  btn.appendChild(iconContainer);

  const { storageKey, fillColorOn, fillColorOff, displayTextOn, displayTextOff } = button.toggle;

  let toggleTextEl = null;
  if (displayTextOn || displayTextOff) {
    toggleTextEl = document.createElement("span");
    btn.appendChild(toggleTextEl);
  }

  const applyState = (isActive, isDark = isDarkMode()) => {
    btn.style.backgroundColor = resolveColor(isActive ? fillColorOn : fillColorOff, isDark);
    iconOnEl.style.opacity = isActive ? "1" : "0";
    iconOffEl.style.opacity = isActive ? "0" : "1";
    if (toggleTextEl) toggleTextEl.textContent = isActive ? (displayTextOn ?? "") : (displayTextOff ?? "");
  };

  chrome.storage.local.get(storageKey, (data) => applyState(data[storageKey] !== false));

  if ([fillColorOn, fillColorOff].some(v => typeof v === 'object')) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
      chrome.storage.local.get(storageKey, (data) => applyState(data[storageKey] !== false, e.matches));
    });
  }

  btn.addEventListener("click", () => {
    chrome.storage.local.get(storageKey, (data) => {
      const isActive = data[storageKey] !== false;
      if (isActive) {
        chrome.storage.local.set({ [storageKey]: false }, () => applyState(false));
      } else {
        chrome.storage.local.remove(storageKey, () => applyState(true));
      }
    });
  });

  const hasText = displayTextOn || displayTextOff;
  btn.style.padding = hasText ? "9px 13px" : "10.5px 10.5px";

  return btn;
}

async function renderPopupButtons() {
  const versionEl = document.getElementById("mb-popup-version");
  if (versionEl) versionEl.textContent = "v" + chrome.runtime.getManifest().version;

  const [{ createButton }, { pageMatchesUrl, resolveColor, isDarkMode }] = await Promise.all([
    import(chrome.runtime.getURL('scripts/buttons.js')),
    import(chrome.runtime.getURL('scripts/utils.js')),
  ]);

  const [buttonsRes, containersRes] = await Promise.all([
    fetch(chrome.runtime.getURL("config/buttons.json")),
    fetch(chrome.runtime.getURL("config/containers.json")),
  ]);
  const buttons = await buttonsRes.json();
  const containers = await containersRes.json();

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url ?? "";

  // Read the master switch before building the body so a disabled popup never
  // flashes its hidden buttons on open.
  const root = document.querySelector(".mb-popup");
  const applyEnabledState = (isEnabled) => root?.classList.toggle("--disabled", !isEnabled);
  const initialEnabled = await new Promise(resolve =>
    chrome.storage.local.get("moreButtonsActive", d => resolve(d.moreButtonsActive !== false))
  );
  applyEnabledState(initialEnabled);

  const dispatch = (action) => {
    const [actionName, ...params] = action.split(':');
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, { type: "runAction", actionName, params });
        window.close();
      }
    });
  };

  const popupButtons = buttons.filter(b =>
    b.containerId?.startsWith("popup-") && pageMatchesUrl(b.pageMatch, url)
  );

  const popupContainerIds = containers
    .filter(c => c.context === "popup")
    .map(c => c.id);

  // The master enable/disable switch is hoisted out of its container and pinned
  // to the top, above the divider. It stays visible at all times; everything
  // else lives in the body and hides while the extension is off.
  const masterToggle = popupButtons.find(b => b.toggle?.storageKey === "moreButtonsActive");

  const powerControl = document.getElementById("mb-popup-power-control");
  if (masterToggle && powerControl) {
    powerControl.appendChild(createToggleButton(masterToggle, { resolveColor, isDarkMode }));
  }

  const wrapper = document.getElementById("popup-buttons-container");

  for (const containerId of popupContainerIds) {
    const group = popupButtons.filter(b => b.containerId === containerId && b !== masterToggle);
    if (!group.length) continue;

    const groupEl = document.createElement("div");
    groupEl.id = containerId;
    groupEl.style.display = "flex";
    groupEl.style.flexWrap = "wrap";
    groupEl.style.gap = "4px";

    for (const btn of group) {
      groupEl.appendChild(btn.toggle ? createToggleButton(btn, { resolveColor, isDarkMode }) : createButton(btn, dispatch));
    }

    wrapper.appendChild(groupEl);
  }

  // Keep the shell in sync when the switch is flipped: while the extension is
  // off, every other button is hidden (they can't act on the page), leaving
  // just the switch and an explanatory note. Storage-driven so it tracks the
  // toggle's own click handler and changes made from any other surface.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && "moreButtonsActive" in changes) {
      applyEnabledState(changes.moreButtonsActive.newValue !== false);
    }
  });
}

renderPopupButtons();
