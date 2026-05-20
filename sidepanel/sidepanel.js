// Shell do side panel: monta tabs (Login se sem auth, módulos registrados, Settings).
import { MSG, send } from "../lib/messages.js";
import { el, clear } from "../ui/components.js";
import * as registry from "../lib/module-registry.js";
import { mountLogin } from "./tabs/login.js";
import { mountSettings } from "./tabs/settings.js";

// Registra módulos (Petlove é o primeiro).
import "../modules/petlove/index.js";

const tabsContainer = document.getElementById("tabs");
const content = document.getElementById("content");
const userInfo = document.getElementById("user-info");

const state = {
  activeTabId: null,
  user: null,
};

async function refreshUser() {
  try {
    state.user = await send(MSG.YZILAB_GET_USER);
  } catch {
    state.user = null;
  }
  userInfo.textContent = state.user ? state.user.email || "logado" : "não autenticado";
}

function buildTabs() {
  const tabs = [];
  if (!state.user) {
    tabs.push({ id: "login", label: "Entrar", mount: (c) => mountLogin(c, { onLogin: render }) });
  } else {
    for (const mod of registry.list()) {
      for (const t of mod.tabs || []) {
        tabs.push({
          id: `${mod.id}:${t.id}`,
          label: t.label,
          mount: t.mount,
        });
      }
    }
  }
  tabs.push({
    id: "settings",
    label: "Config",
    mount: (c) => mountSettings(c, { onLogout: render }),
  });
  return tabs;
}

async function render() {
  await refreshUser();
  const tabs = buildTabs();
  if (!tabs.find((t) => t.id === state.activeTabId)) {
    state.activeTabId = tabs[0].id;
  }
  clear(tabsContainer);
  for (const tab of tabs) {
    tabsContainer.appendChild(
      el(
        "button",
        {
          class: tab.id === state.activeTabId ? "active" : "",
          onclick: () => {
            state.activeTabId = tab.id;
            render();
          },
        },
        tab.label
      )
    );
  }
  clear(content);
  const active = tabs.find((t) => t.id === state.activeTabId);
  try {
    await active.mount(content);
  } catch (err) {
    content.appendChild(el("div", { class: "empty-state" }, `Erro ao montar aba: ${err.message}`));
  }
}

render();
