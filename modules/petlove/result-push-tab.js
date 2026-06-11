import { MSG, send } from "../../lib/messages.js";
import { el, clear, table, badge, toast, spinnerText } from "../../ui/components.js";

export async function mountResultPushTab(container) {
  clear(container);
  const settings = await send(MSG.GET_SETTINGS);
  const frontBaseUrl = (settings?.yzilabFrontUrl || "https://app.animalex.com.br").replace(/\/$/, "");
  if (settings && settings.autoSyncEnabled) {
    return mountAutoHistory(container, settings, { frontBaseUrl });
  }
  return mountManualQueue(container, { frontBaseUrl });
}

function manageLink(frontBaseUrl) {
  const link = el("a", { href: "#", class: "manage-sync-link" }, [
    el("i", { class: "manage-icon" }, "⚙"),
    " Gerenciar sincronização",
  ]);
  link.addEventListener("click", (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: `${frontBaseUrl}/health-insurance/result-status` });
  });
  return link;
}

function protocolCell(protocol, frontBaseUrl) {
  if (!protocol) return "—";
  if (!frontBaseUrl) return String(protocol);
  const link = el("a", { href: "#", class: "protocol-link", title: "Abrir no sistema" }, `#${protocol}`);
  link.addEventListener("click", (e) => {
    e.preventDefault();
    const url = `${frontBaseUrl}/health-insurance/result-status?q=${encodeURIComponent(protocol)}&filter_by=protocol&status=all&health_insurance_id=all`;
    chrome.tabs.create({ url });
  });
  return link;
}

async function mountManualQueue(container, { frontBaseUrl }) {
  const refreshBtn = el("button", { class: "primary" }, "Atualizar fila");
  const pushAllBtn = el("button", { class: "secondary" }, "Sincronizar todos");
  const statusEl = el("div", { class: "small muted" }, "");
  const listEl = el("div", {});

  container.appendChild(
    el("div", { class: "actions-row" }, [
      el("div", { class: "row" }, [refreshBtn, pushAllBtn]),
      statusEl,
    ])
  );
  container.appendChild(el("div", { class: "manage-row" }, [manageLink(frontBaseUrl)]));
  container.appendChild(listEl);

  const state = { items: [], rowStates: new Map() };

  function rowStatusBadge(stateValue) {
    switch (stateValue) {
      case "pushing": return badge("enviando…", "warning");
      case "done": return badge("enviado", "success");
      case "failed": return badge("falhou", "danger");
      default: return badge("pendente", "info");
    }
  }

  function renderRows() {
    clear(listEl);
    const rows = state.items.map((it) => {
      const rowState = state.rowStates.get(it.external_request_id) || it.result_sync_status || "pending";
      return {
        protocol: protocolCell(it.protocol, frontBaseUrl),
        patient: it.patient_name || "—",
        clinic: it.clinic_name || "—",
        external: it.external_request_id,
        attachments: (it.attachments || []).length,
        status: rowStatusBadge(rowState),
        action: pushButton(it),
        _raw: it,
      };
    });
    listEl.appendChild(
      table(
        [
          { key: "protocol", label: "Protocolo" },
          { key: "patient", label: "Pet" },
          { key: "clinic", label: "Clínica" },
          { key: "external", label: "ID Petlove" },
          { key: "attachments", label: "PDFs" },
          { key: "status", label: "Status" },
          { key: "action", label: "" },
        ],
        rows,
        { empty: "Nada pendente para enviar à Petlove." }
      )
    );
  }

  function pushButton(item) {
    const btn = el("button", { class: "primary" }, "Sincronizar");
    btn.addEventListener("click", async () => {
      await pushOne(item, btn);
    });
    return btn;
  }

  async function pushOne(item, btn) {
    state.rowStates.set(item.external_request_id, "pushing");
    if (btn) btn.disabled = true;
    renderRows();
    try {
      await send(MSG.PETLOVE_PUSH_RESULT, {
        mappingIds: item.mapping_ids,
        externalRequestId: item.external_request_id,
        attachments: item.attachments,
      });
      state.rowStates.set(item.external_request_id, "done");
      toast(`Enviado: ${item.protocol || item.external_request_id}`, { type: "success" });
    } catch (err) {
      state.rowStates.set(item.external_request_id, "failed");
      toast(`Falha em ${item.external_request_id}: ${err.message}`, { type: "error", duration: 6000 });
    } finally {
      if (btn) btn.disabled = false;
      renderRows();
    }
  }

  async function refresh() {
    refreshBtn.disabled = true;
    pushAllBtn.disabled = true;
    statusEl.textContent = "buscando…";
    clear(listEl);
    listEl.appendChild(spinnerText("consultando fila de envio…"));
    try {
      state.items = await send(MSG.YZILAB_RESULT_PUSH_QUEUE, {});
      statusEl.textContent = `${state.items.length} laudos`;
      state.rowStates.clear();
      renderRows();
    } catch (err) {
      statusEl.textContent = "";
      clear(listEl);
      listEl.appendChild(el("div", { class: "empty-state" }, `Erro: ${err.message}`));
      toast(err.message, { type: "error", duration: 6000 });
    } finally {
      refreshBtn.disabled = false;
      pushAllBtn.disabled = false;
    }
  }

  async function pushAll() {
    pushAllBtn.disabled = true;
    refreshBtn.disabled = true;
    for (const item of state.items) {
      const current = state.rowStates.get(item.external_request_id);
      if (current === "done" || current === "pushing") continue;
      try {
        await pushOne(item, null);
      } catch {
        // toast já mostra; segue
      }
    }
    pushAllBtn.disabled = false;
    refreshBtn.disabled = false;
  }

  refreshBtn.addEventListener("click", refresh);
  pushAllBtn.addEventListener("click", pushAll);
  refresh();
}

// ─── Modo automático: indicador + histórico do /result-sync/ ──────────────
async function mountAutoHistory(container, settings, { frontBaseUrl } = {}) {
  const intervalMin = settings.autoSyncIntervalMinutes || 15;

  const banner = el("div", { class: "auto-banner" }, [
    el("strong", {}, "Sincronização automática ativa "),
    el("span", { class: "small muted" }, `(a cada ${intervalMin} min)`),
  ]);
  const lastRunEl = el("div", { class: "small muted" }, "");
  const runNowBtn = el("button", { class: "primary" }, "Sincronizar agora");
  const refreshBtn = el("button", { class: "secondary" }, "Atualizar histórico");
  const statusFilter = el("select", { style: { maxWidth: "180px" } });
  for (const opt of [
    { v: "all", l: "Todos status" },
    { v: "awaiting_results", l: "Aguardando resultados" },
    { v: "completed", l: "Concluídos" },
    { v: "failed", l: "Falhas" },
    { v: "accepted", l: "Em andamento" },
    { v: "pending", l: "Pendentes" },
    { v: "waiting_siblings", l: "Aguardando irmãos" },
    { v: "syncing", l: "Sincronizando" },
  ]) {
    statusFilter.appendChild(el("option", { value: opt.v }, opt.l));
  }
  const listEl = el("div", {});

  container.appendChild(banner);
  container.appendChild(lastRunEl);
  container.appendChild(
    el("div", { class: "actions-row" }, [
      el("div", { class: "row" }, [runNowBtn, refreshBtn, statusFilter]),
      el("div", { class: "small muted" }, ""),
    ])
  );
  if (frontBaseUrl) container.appendChild(el("div", { class: "manage-row" }, [manageLink(frontBaseUrl)]));
  container.appendChild(listEl);

  async function updateLastRun() {
    try {
      const info = await send(MSG.AUTO_SYNC_STATUS);
      if (!info || !info.lastRunAt) {
        lastRunEl.textContent = "Nenhuma rodada ainda — aguardando o próximo ciclo.";
        return;
      }
      const when = new Date(info.lastRunAt).toLocaleString();
      const last = info.lastResult || {};
      const parts = [`última rodada: ${when}`];
      if (last.aborted) {
        parts.push(`abortada: ${(last.errors || [])[0] || "sem sessão Petlove"}`);
      } else {
        parts.push(`processados: ${last.processed || 0}`);
        if (last.failed) parts.push(`falhas: ${last.failed}`);
      }
      lastRunEl.textContent = parts.join("  ·  ");
    } catch {
      lastRunEl.textContent = "";
    }
  }

  function rowStatusBadge(value) {
    switch (value) {
      case "completed": return badge("concluído", "success");
      case "accepted": return badge("aceito", "info");
      case "syncing": return badge("sincronizando", "warning");
      case "waiting_siblings": return badge("aguardando irmãos", "warning");
      case "failed": return badge("falhou", "danger");
      case "pending":
      default:
        return badge(value || "pendente", "info");
    }
  }

  async function refresh() {
    refreshBtn.disabled = true;
    runNowBtn.disabled = true;
    clear(listEl);
    listEl.appendChild(spinnerText("carregando histórico…"));
    try {
      const data = await send(MSG.YZILAB_RESULT_SYNC_LIST, {
        status: statusFilter.value,
        page: 1,
        pageSize: 50,
      });
      const items = (data && data.results) || [];
      clear(listEl);
      if (items.length === 0) {
        listEl.appendChild(el("div", { class: "empty-state" }, "Sem registros no histórico."));
      } else {
        listEl.appendChild(
          table(
            [
              { key: "protocol", label: "Protocolo", render: (r) => protocolCell(r.protocol, frontBaseUrl) },
              { key: "patient", label: "Pet", render: (r) => r.patient_name || "—" },
              { key: "clinic", label: "Clínica", render: (r) => r.clinic_name || "—" },
              { key: "external", label: "ID Petlove", render: (r) => r.external_request_id },
              { key: "status", label: "Status", render: (r) => rowStatusBadge(r.result_sync_status) },
              {
                key: "when",
                label: "Sincronizado em",
                render: (r) => r.result_sync_completed_at || r.result_sync_attempted_at || "—",
              },
              {
                key: "error",
                label: "",
                render: (r) =>
                  r.result_sync_error
                    ? el("span", { class: "small", style: { color: "var(--danger)" } }, r.result_sync_error)
                    : "",
              },
            ],
            items,
            { empty: "Sem registros." }
          )
        );
      }
      await updateLastRun();
    } catch (err) {
      clear(listEl);
      listEl.appendChild(el("div", { class: "empty-state" }, `Erro: ${err.message}`));
      toast(err.message, { type: "error", duration: 6000 });
    } finally {
      refreshBtn.disabled = false;
      runNowBtn.disabled = false;
    }
  }

  runNowBtn.addEventListener("click", async () => {
    runNowBtn.disabled = true;
    runNowBtn.textContent = "sincronizando…";
    try {
      const result = await send(MSG.AUTO_SYNC_RUN_NOW);
      if (result && result.aborted) {
        toast(`Sincronização abortada: ${(result.errors || [])[0] || "sem sessão"}`, {
          type: "error",
          duration: 6000,
        });
      } else if (result) {
        toast(`Processados: ${result.processed || 0}, falhas: ${result.failed || 0}`, {
          type: result.failed ? "error" : "success",
          duration: 5000,
        });
      }
    } catch (err) {
      toast(`Erro: ${err.message}`, { type: "error", duration: 6000 });
    } finally {
      runNowBtn.disabled = false;
      runNowBtn.textContent = "Sincronizar agora";
      await refresh();
    }
  });
  refreshBtn.addEventListener("click", refresh);
  statusFilter.addEventListener("change", refresh);
  refresh();
}
