import { MSG, send } from "../../lib/messages.js";
import { el, clear, badge, toast, spinnerText } from "../../ui/components.js";
import { openMappingModal } from "./mapping-modal.js";

const FILTER_DEFS = [
  { key: "pet_name", label: "Pet", type: "text", placeholder: "Nome do pet" },
  { key: "microchip", label: "Microchip", type: "text", placeholder: "Número do chip" },
  { key: "customer_name", label: "Tutor", type: "text", placeholder: "Nome do tutor" },
  { key: "customer_cpf", label: "CPF", type: "text", placeholder: "CPF do tutor" },
  { key: "date_from", label: "Data de", type: "date" },
  { key: "date_to", label: "Data até", type: "date" },
];

export async function mountInboxTab(container) {
  clear(container);

  const filterInputs = new Map();

  // ── Pill de filtros (colapsado por padrão) ──
  const pillCount = el("span", { class: "pill-count", style: { display: "none" } }, "0");
  const pillCaret = el("span", { class: "pill-caret" }, "▾");
  const pill = el("button", { class: "filters-pill", type: "button" }, [
    el("span", {}, "Filtros"),
    pillCount,
    pillCaret,
  ]);

  // ── Grid de filtros (hidden por padrão) ──
  const filtersGrid = el("div", { class: "filters-grid hidden" });
  for (const def of FILTER_DEFS) {
    const input = el("input", { type: def.type, placeholder: def.placeholder || "" });
    input.addEventListener("input", updateFilterCount);
    input.addEventListener("change", updateFilterCount);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") refresh();
    });
    filterInputs.set(def.key, input);
    filtersGrid.appendChild(
      el("div", { class: "field" }, [el("label", {}, def.label), input])
    );
  }

  // ── Ações principais ──
  const refreshBtn = el("button", { class: "primary" }, "Atualizar inbox");
  const clearBtn = el("button", { class: "ghost" }, "Limpar filtros");
  const statusEl = el("div", { class: "small muted" }, "");
  const sessionWarning = el("div", {});
  const listEl = el("div", {});

  const toolbar = el("div", { class: "filters-toolbar" }, [
    pill,
    el("div", { class: "small muted" }, ""),
  ]);
  container.appendChild(toolbar);
  container.appendChild(filtersGrid);
  container.appendChild(
    el("div", { class: "actions-row" }, [
      el("div", { class: "row" }, [refreshBtn, clearBtn]),
      statusEl,
    ])
  );
  container.appendChild(sessionWarning);
  container.appendChild(listEl);

  function countActiveFilters() {
    let n = 0;
    for (const input of filterInputs.values()) {
      if ((input.value || "").trim()) n += 1;
    }
    return n;
  }

  function updateFilterCount() {
    const n = countActiveFilters();
    pillCount.textContent = String(n);
    pillCount.style.display = n > 0 ? "inline-block" : "none";
    pill.classList.toggle("active", n > 0);
  }

  function setFiltersOpen(open) {
    filtersGrid.classList.toggle("hidden", !open);
    pillCaret.textContent = open ? "▴" : "▾";
    if (open) {
      const first = filterInputs.values().next().value;
      if (first) setTimeout(() => first.focus(), 0);
    }
  }

  pill.addEventListener("click", () => {
    setFiltersOpen(filtersGrid.classList.contains("hidden"));
  });

  async function checkPetloveSession() {
    sessionWarning.replaceChildren();
    try {
      const info = await send(MSG.PETLOVE_GET_SESSION_INFO);
      if (!info || !info.has_session_cookie) {
        const link = el("button", { class: "ghost" }, "Abrir Petlove");
        link.addEventListener("click", () =>
          chrome.tabs.create({ url: "https://central-de-saude.petlove.com.br/" })
        );
        sessionWarning.appendChild(
          el("div", { class: "empty-state" }, [
            "Sem sessão Petlove. Faça login em central-de-saude.petlove.com.br. ",
            link,
          ])
        );
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  function readFilters() {
    const out = {};
    for (const [key, input] of filterInputs) {
      const v = (input.value || "").trim();
      if (v) out[key] = v;
    }
    return out;
  }

  async function refresh() {
    const ok = await checkPetloveSession();
    if (!ok) return;
    refreshBtn.disabled = true;
    clearBtn.disabled = true;
    statusEl.textContent = "buscando…";
    clear(listEl);
    listEl.appendChild(spinnerText("buscando pendentes na Petlove…"));
    try {
      const items = await send(MSG.PETLOVE_FETCH_INBOX, readFilters());
      statusEl.textContent = `${items.length} pendentes`;
      clear(listEl);
      if (items.length === 0) {
        listEl.appendChild(el("div", { class: "empty-state" }, "Nenhum pedido pendente."));
      } else {
        for (const item of items) {
          listEl.appendChild(renderCard(item, refresh));
        }
      }
      setFiltersOpen(false);
      updateFilterCount();
    } catch (err) {
      statusEl.textContent = "";
      clear(listEl);
      listEl.appendChild(el("div", { class: "empty-state" }, `Erro: ${err.message}`));
      toast(err.message, { type: "error", duration: 6000 });
    } finally {
      refreshBtn.disabled = false;
      clearBtn.disabled = false;
    }
  }

  refreshBtn.addEventListener("click", refresh);
  clearBtn.addEventListener("click", () => {
    for (const input of filterInputs.values()) input.value = "";
    updateFilterCount();
    refresh();
  });
  updateFilterCount();
  refresh();
}

function renderCard(item, onProcessed) {
  const card = el("div", { class: "inbox-card" });

  // Header
  const header = el(
    "div",
    { class: "card-header-row" },
    [
      el("div", {}, [
        el("h5", { class: "card-pet-name" }, item.pet?.name || "Sem nome"),
        el(
          "small",
          { class: "muted" },
          [item.pet?.species, item.pet?.breed_external_name, item.pet?.sex]
            .filter(Boolean)
            .join(" · ") || ""
        ),
      ]),
      el("div", { class: "card-header-right" }, [
        badge("Petlove", "success"),
        el("div", { class: "small muted" }, `#${item.external_request_id}`),
      ]),
    ]
  );
  card.appendChild(header);

  // Tutor / Telefone
  card.appendChild(
    twoCols(
      ["Tutor", strongWithSub(item.pet?.tutor_name || "-", item.pet?.tutor_document)],
      ["Telefone", el("strong", {}, item.pet?.tutor_phone || "-")]
    )
  );

  // Microchip / Idade
  card.appendChild(
    twoCols(
      ["Microchip", el("strong", {}, item.pet?.microchip || "-")],
      ["Idade", el("strong", {}, formatAge(item.pet?.age))]
    )
  );

  // Clínica / Vet (externos)
  const vetText = item.veterinary?.external_name
    ? `${item.veterinary.external_name}${item.veterinary.external_crmv ? " (" + item.veterinary.external_crmv + ")" : ""}`
    : "-";
  card.appendChild(
    twoCols(
      ["Clínica de origem", el("strong", {}, item.clinic?.external_name || "-")],
      ["Veterinário", el("strong", {}, vetText)]
    )
  );

  // Exames
  const examsRow = el("div", { class: "field-row" }, [
    el("small", { class: "muted" }, `Exames (${(item.exams || []).length})`),
    el(
      "div",
      { class: "exam-badges" },
      (item.exams || []).map((e) => badge(e.external_name || e.external_id, "info"))
    ),
  ]);
  card.appendChild(examsRow);

  // Informações clínicas
  if (item.clinical_info && item.clinical_info.length > 0) {
    const list = el("ul", { class: "clinical-list" });
    for (const info of item.clinical_info) {
      list.appendChild(
        el("li", {}, [el("strong", {}, `${info.label}: `), info.value])
      );
    }
    card.appendChild(
      el("div", { class: "field-row" }, [
        el("small", { class: "muted" }, "Informações clínicas"),
        list,
      ])
    );
  }

  // Suspeita clínica
  if (item.clinical_suspicion) {
    card.appendChild(
      el("div", { class: "field-row" }, [
        el("small", { class: "muted" }, "Suspeita clínica"),
        el("em", {}, item.clinical_suspicion),
      ])
    );
  }

  // Notas
  if (item.notes) {
    card.appendChild(
      el("div", { class: "field-row" }, [
        el("small", { class: "muted" }, "Observações"),
        el("em", {}, item.notes),
      ])
    );
  }

  // Footer
  const processBtn = el("button", { class: "primary" }, "Iniciar processamento");
  processBtn.addEventListener("click", () => openMappingModal(item, { onProcessed }));
  card.appendChild(
    el("div", { class: "card-footer-row" }, [
      el("small", { class: "muted" }, item.created_at ? `Recebido: ${item.created_at}` : ""),
      processBtn,
    ])
  );

  return card;
}

function twoCols(left, right) {
  return el("div", { class: "two-cols" }, [
    el("div", {}, [el("small", { class: "muted" }, left[0]), left[1]]),
    el("div", {}, [el("small", { class: "muted" }, right[0]), right[1]]),
  ]);
}

function strongWithSub(main, sub) {
  const node = el("strong", {}, main);
  if (sub) {
    const wrap = el("div", {});
    wrap.appendChild(node);
    wrap.appendChild(el("div", {}, el("small", { class: "muted" }, sub)));
    return wrap;
  }
  return node;
}

function formatAge(age) {
  if (!age || age <= 0) return "-";
  if (age < 30) return `${age} dia${age > 1 ? "s" : ""}`;
  if (age < 365) {
    const months = Math.floor(age / 30);
    return `${months} ${months > 1 ? "meses" : "mês"}`;
  }
  const years = Math.floor(age / 365);
  return `${years} ano${years > 1 ? "s" : ""}`;
}

