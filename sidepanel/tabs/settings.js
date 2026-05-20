import { MSG, send } from "../../lib/messages.js";
import { el, clear, toast } from "../../ui/components.js";

const BASE_PRESETS = [
  { label: "Produção (app.animalex.com.br)", value: "https://app.animalex.com.br" },
  { label: "Local (localhost:8100)", value: "http://localhost:8100" },
  { label: "Local (localhost:8000)", value: "http://localhost:8000" },
];

export async function mountSettings(container, { onLogout }) {
  clear(container);

  const settings = await send(MSG.GET_SETTINGS);
  const user = await send(MSG.YZILAB_GET_USER);
  const petloveInfo = await send(MSG.PETLOVE_GET_SESSION_INFO).catch(() => null);

  // ─ Base URL ─
  const select = el("select", {});
  const isCustom = !BASE_PRESETS.find((p) => p.value === settings.yzilabBaseUrl);
  for (const preset of BASE_PRESETS) {
    const opt = el("option", { value: preset.value }, preset.label);
    if (preset.value === settings.yzilabBaseUrl) opt.setAttribute("selected", "");
    select.appendChild(opt);
  }
  const customOpt = el("option", { value: "__custom" }, "Personalizado");
  if (isCustom) customOpt.setAttribute("selected", "");
  select.appendChild(customOpt);

  const customInput = el("input", {
    type: "text",
    value: isCustom ? settings.yzilabBaseUrl : "",
    placeholder: "https://meu-servidor.com",
  });
  customInput.style.marginTop = "6px";
  customInput.style.display = isCustom ? "block" : "none";

  select.addEventListener("change", () => {
    customInput.style.display = select.value === "__custom" ? "block" : "none";
  });

  const saveBtn = el("button", { class: "primary" }, "Salvar");
  saveBtn.addEventListener("click", async () => {
    const base = select.value === "__custom" ? customInput.value.trim() : select.value;
    if (!base) {
      toast("Informe uma URL", { type: "error" });
      return;
    }
    await send(MSG.SET_SETTINGS, { yzilabBaseUrl: base });
    toast("Configurações salvas", { type: "success" });
  });

  container.appendChild(
    el("div", { class: "field" }, [
      el("label", {}, "URL da Animalex"),
      select,
      customInput,
    ])
  );
  container.appendChild(el("div", { class: "row" }, [saveBtn]));

  // ─ Sincronização automática ─
  container.appendChild(el("hr", { style: { margin: "16px 0", border: "none", borderTop: "1px solid var(--border)" } }));
  const autoToggle = el("input", { type: "checkbox", id: "auto-sync-toggle" });
  if (settings.autoSyncEnabled) autoToggle.setAttribute("checked", "");
  const intervalInput = el("input", {
    type: "number",
    min: "5",
    max: "120",
    value: String(settings.autoSyncIntervalMinutes || 15),
    style: { maxWidth: "80px" },
  });
  const autoStatusEl = el("div", { class: "small muted" }, "");

  async function refreshAutoStatus() {
    try {
      const info = await send(MSG.AUTO_SYNC_STATUS);
      if (!info || !info.enabled) {
        autoStatusEl.textContent = "Desativado — você sincroniza manualmente.";
        return;
      }
      const last = info.lastResult;
      if (!info.lastRunAt) {
        autoStatusEl.textContent = `Ativo. Próxima rodada em até ${info.intervalMinutes} min.`;
      } else {
        const when = new Date(info.lastRunAt).toLocaleString();
        autoStatusEl.textContent = `Última rodada: ${when}  ·  processados: ${(last && last.processed) || 0}  ·  falhas: ${(last && last.failed) || 0}`;
      }
    } catch {
      autoStatusEl.textContent = "";
    }
  }

  autoToggle.addEventListener("change", async () => {
    await send(MSG.SET_SETTINGS, { autoSyncEnabled: autoToggle.checked });
    toast(autoToggle.checked ? "Sincronização automática ligada" : "Sincronização automática desligada", {
      type: "success",
    });
    refreshAutoStatus();
  });

  intervalInput.addEventListener("change", async () => {
    let v = parseInt(intervalInput.value, 10);
    if (!Number.isFinite(v) || v < 5) v = 5;
    if (v > 120) v = 120;
    intervalInput.value = String(v);
    await send(MSG.SET_SETTINGS, { autoSyncIntervalMinutes: v });
    toast(`Intervalo atualizado para ${v} min`, { type: "success" });
    refreshAutoStatus();
  });

  container.appendChild(
    el("div", { class: "field" }, [
      el("label", {}, "Sincronização automática com Petlove"),
      el("div", { class: "checkbox-row" }, [
        autoToggle,
        el("label", { for: "auto-sync-toggle" }, " Sincronizar laudos prontos sem revisão manual"),
      ]),
      el("div", { class: "small muted", style: { marginTop: "6px" } }, "Intervalo (minutos):"),
      el("div", { class: "row", style: { marginTop: "4px" } }, [intervalInput]),
      autoStatusEl,
    ])
  );
  refreshAutoStatus();

  // ─ Conta YziLab ─
  container.appendChild(el("hr", { style: { margin: "16px 0", border: "none", borderTop: "1px solid var(--border)" } }));
  container.appendChild(
    el("div", { class: "field" }, [
      el("label", {}, "Conta Animalex"),
      el(
        "div",
        { class: "small" },
        user ? `${user.email || ""} ${user.first_name ? "— " + user.first_name : ""}` : "não autenticado"
      ),
    ])
  );
  if (user) {
    const logoutBtn = el("button", { class: "danger" }, "Sair");
    logoutBtn.addEventListener("click", async () => {
      await send(MSG.YZILAB_LOGOUT);
      toast("Sessão encerrada");
      onLogout && onLogout();
    });
    container.appendChild(el("div", { class: "row" }, [logoutBtn]));
  }

  // ─ Sessão Petlove ─
  container.appendChild(el("hr", { style: { margin: "16px 0", border: "none", borderTop: "1px solid var(--border)" } }));
  container.appendChild(
    el("div", { class: "field" }, [
      el("label", {}, "Sessão Petlove (capturada do navegador)"),
      el(
        "div",
        { class: "small" },
        petloveInfo
          ? `${petloveInfo.has_session_cookie ? "✓ session" : "✗ session"}  ${petloveInfo.has_xsrf ? "✓ xsrf" : "✗ xsrf"}  ${petloveInfo.has_access_token ? "✓ access(" + (petloveInfo.access_source || "?") + ")" : "—"}  ${petloveInfo.access_preview || ""}`
          : "Sem sessão. Abra central-de-saude.petlove.com.br e faça login."
      ),
      petloveInfo && petloveInfo.captured_at
        ? el("div", { class: "small muted" }, `Capturado: ${new Date(petloveInfo.captured_at).toLocaleString()}`)
        : null,
    ])
  );
  const openPetlove = el("button", { class: "secondary" }, "Abrir Petlove");
  openPetlove.addEventListener("click", () => {
    chrome.tabs.create({ url: "https://central-de-saude.petlove.com.br/" });
  });
  container.appendChild(el("div", { class: "row" }, [openPetlove]));
}
