function buildButton(def, iconName, text) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.id = def.id;
  btn.className = "more-buttons-button";
  if (def.descriptionText) btn.title = def.descriptionText;
  const icon = document.createElement("span");
  icon.className = "more-buttons-icon";
  icon.textContent = iconName ?? "";
  btn.appendChild(icon);
  const label = document.createTextNode(text ?? "");
  btn.appendChild(label);
  return { btn, icon, label };
}

function createPopupButton(def, dispatch) {
  const { btn } = buildButton(def, def.icon, def.displayText);
  if (def.colour) btn.classList.add(def.colour);
  btn.addEventListener("click", () => dispatch(def.action));
  return btn;
}

function createToggleButton(def) {
  const { storageKey, iconOn, iconOff, colourOn, colourOff, displayTextOn, displayTextOff } = def.toggle;
  const { btn, icon, label } = buildButton(def, iconOff, displayTextOff);

  const applyState = (isActive) => {
    if (colourOn) btn.classList.toggle(colourOn, isActive);
    if (colourOff) btn.classList.toggle(colourOff, !isActive);
    icon.textContent = (isActive ? iconOn : iconOff) ?? "";
    label.textContent = (isActive ? displayTextOn : displayTextOff) ?? "";
  };

  chrome.storage.local.get(storageKey, (data) => applyState(data[storageKey] !== false));

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

  return btn;
}

async function renderPopupButtons() {
  const versionEl = document.getElementById("mb-popup-version");
  if (versionEl) versionEl.textContent = "v" + chrome.runtime.getManifest().version;

  const [{ pageMatchesUrl }, { orderDockButtons, normaliseGroup }] = await Promise.all([
    import(chrome.runtime.getURL('scripts/utils.js')),
    import(chrome.runtime.getURL('scripts/dockLayout.js')),
  ]);

  const buttons = await (await fetch(chrome.runtime.getURL("config/buttons.json"))).json();

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
    b.surface === "popup" && pageMatchesUrl(b.pageMatch, url)
  );

  // The master enable/disable switch is hoisted out of its group and pinned
  // to the top, above the divider. It stays visible at all times; everything
  // else lives in the body and hides while the extension is off.
  const masterToggle = popupButtons.find(b => b.toggle?.storageKey === "moreButtonsActive");

  const powerControl = document.getElementById("mb-popup-power-control");
  if (masterToggle && powerControl) {
    powerControl.appendChild(createToggleButton(masterToggle));
  }

  const wrapper = document.getElementById("popup-buttons-container");
  const rest = popupButtons.filter(b => b !== masterToggle);

  for (const group of orderDockButtons(rest)) {
    if (!group.length) continue;
    const groupEl = document.createElement("div");
    groupEl.className = "mb-popup__group";
    const name = normaliseGroup(group[0].dockGroup);
    if (name) groupEl.dataset.group = name;
    for (const def of group) {
      groupEl.appendChild(def.toggle ? createToggleButton(def) : createPopupButton(def, dispatch));
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
