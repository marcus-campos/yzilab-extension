// Componentes UI mínimos: criação de elementos, toast, modal.

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "style" && typeof v === "object") Object.assign(node.style, v);
    else if (k === "html") node.innerHTML = v;
    else if (k.startsWith("on") && typeof v === "function") {
      node.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (v === true) {
      node.setAttribute(k, "");
    } else if (v !== false && v != null) {
      node.setAttribute(k, v);
    }
  }
  const items = Array.isArray(children) ? children : [children];
  for (const child of items) {
    if (child == null || child === false) continue;
    if (typeof child === "string" || typeof child === "number") {
      node.appendChild(document.createTextNode(String(child)));
    } else {
      node.appendChild(child);
    }
  }
  return node;
}

export function clear(container) {
  while (container.firstChild) container.removeChild(container.firstChild);
}

// ─── Toasts ─────────────────────────────────────────────────────────────────
let toastContainer;
function ensureToastContainer() {
  if (!toastContainer) {
    toastContainer = el("div", { class: "toast-container" });
    document.body.appendChild(toastContainer);
  }
  return toastContainer;
}

export function toast(message, { type = "info", duration = 3000 } = {}) {
  const container = ensureToastContainer();
  const node = el("div", { class: `toast ${type}` }, message);
  container.appendChild(node);
  setTimeout(() => {
    node.style.opacity = "0";
    node.style.transition = "opacity 200ms";
    setTimeout(() => node.remove(), 220);
  }, duration);
}

// ─── Modal ──────────────────────────────────────────────────────────────────
export function openModal(renderBody, { title = "" } = {}) {
  const backdrop = el("div", { class: "modal-backdrop" });
  const modal = el("div", { class: "modal" });
  const close = () => backdrop.remove();
  if (title) modal.appendChild(el("h3", {}, title));
  const body = el("div", {});
  modal.appendChild(body);
  backdrop.appendChild(modal);
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) close();
  });
  document.body.appendChild(backdrop);
  renderBody({ body, close });
  return { close };
}

// ─── Table ─────────────────────────────────────────────────────────────────
export function table(columns, rows, { empty = "Nenhum item." } = {}) {
  if (!rows || rows.length === 0) {
    return el("div", { class: "empty-state" }, empty);
  }
  const thead = el(
    "thead",
    {},
    el(
      "tr",
      {},
      columns.map((c) => el("th", {}, c.label))
    )
  );
  const tbody = el(
    "tbody",
    {},
    rows.map((r) =>
      el(
        "tr",
        {},
        columns.map((c) => {
          const value = typeof c.render === "function" ? c.render(r) : r[c.key];
          if (value instanceof Node) return el("td", {}, value);
          return el("td", {}, value == null ? "" : String(value));
        })
      )
    )
  );
  return el("table", { class: "data" }, [thead, tbody]);
}

export function badge(text, type = "info") {
  return el("span", { class: `badge ${type}` }, text);
}

export function spinnerText(message = "Carregando…") {
  return el("div", { class: "muted small" }, message);
}

// ─── asyncSearchSelect ─────────────────────────────────────────────────────
// Substituto leve de Select2 para o painel. Mostra um input "selecionado" + dropdown
// com busca paginada e scroll infinito.
//
// fetchPage: async ({q, page}) => {results, count, page, totalPages}
// mapItem:   (item) => ({id, text})
// preset:    {id, text} opcional para pré-selecionar
// onChange:  (selected|null) => void
//
// Retorna o root HTMLElement. .currentValue() e .currentText() para ler.
export function asyncSearchSelect({
  placeholder = "Selecione…",
  fetchPage,
  mapItem,
  preset = null,
  allowClear = false,
  disabled = false,
  onChange,
}) {
  const root = el("div", { class: "asel" });

  // estado
  let selected = preset && preset.id ? { id: String(preset.id), text: preset.text || "" } : null;
  let isOpen = false;
  let isLoading = false;
  let q = "";
  let page = 1;
  let totalPages = 1;
  let items = []; // {id, text}
  let debounceTimer = null;

  // controle/header (campo "fechado" mostrando selecionado)
  const controlText = el("span", { class: "asel-control-text" }, selected ? selected.text : placeholder);
  if (!selected) controlText.classList.add("muted");
  const clearBtn = allowClear
    ? el("button", { type: "button", class: "asel-clear", title: "Limpar" }, "×")
    : null;
  const caret = el("span", { class: "asel-caret" }, "▾");
  const control = el(
    "div",
    { class: "asel-control" + (disabled ? " disabled" : ""), tabindex: "0" },
    [controlText, clearBtn, caret].filter(Boolean)
  );

  // dropdown
  const searchInput = el("input", { type: "text", class: "asel-search", placeholder: "Buscar…" });
  const listEl = el("div", { class: "asel-list" });
  const dropdown = el("div", { class: "asel-dropdown", style: { display: "none" } }, [searchInput, listEl]);

  root.appendChild(control);
  root.appendChild(dropdown);

  function setSelected(next) {
    selected = next;
    controlText.textContent = next ? next.text : placeholder;
    controlText.classList.toggle("muted", !next);
    if (onChange) onChange(next);
  }

  function close() {
    isOpen = false;
    dropdown.style.display = "none";
  }

  function renderList() {
    clear(listEl);
    if (items.length === 0 && !isLoading) {
      listEl.appendChild(el("div", { class: "asel-empty" }, "Sem resultados."));
      return;
    }
    for (const it of items) {
      const item = el(
        "div",
        {
          class: "asel-item" + (selected && selected.id === it.id ? " selected" : ""),
          onclick: () => {
            setSelected(it);
            close();
          },
        },
        it.text
      );
      listEl.appendChild(item);
    }
    if (isLoading) {
      listEl.appendChild(el("div", { class: "asel-loading" }, "carregando…"));
    } else if (page < totalPages) {
      listEl.appendChild(el("div", { class: "asel-more muted small" }, "role para carregar mais"));
    }
  }

  async function fetchAndAppend({ reset }) {
    if (isLoading || disabled) return;
    isLoading = true;
    renderList();
    try {
      const result = await fetchPage({ q, page });
      const mapped = (result.results || []).map(mapItem);
      items = reset ? mapped : items.concat(mapped);
      totalPages = result.totalPages || 1;
    } catch (err) {
      items = [];
      listEl.replaceChildren(el("div", { class: "asel-error" }, "Erro: " + (err.message || err)));
      isLoading = false;
      return;
    }
    isLoading = false;
    renderList();
  }

  function openAndLoad() {
    if (disabled) return;
    isOpen = true;
    dropdown.style.display = "block";
    page = 1;
    q = "";
    searchInput.value = "";
    items = [];
    setTimeout(() => searchInput.focus(), 0);
    fetchAndAppend({ reset: true });
  }

  control.addEventListener("click", (e) => {
    if (clearBtn && e.target === clearBtn) return;
    if (isOpen) close();
    else openAndLoad();
  });
  control.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openAndLoad();
    }
  });

  if (clearBtn) {
    clearBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      setSelected(null);
    });
  }

  searchInput.addEventListener("input", () => {
    q = searchInput.value.trim();
    page = 1;
    items = [];
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => fetchAndAppend({ reset: true }), 250);
  });

  // scroll infinito
  listEl.addEventListener("scroll", () => {
    if (listEl.scrollTop + listEl.clientHeight >= listEl.scrollHeight - 8) {
      if (!isLoading && page < totalPages) {
        page += 1;
        fetchAndAppend({ reset: false });
      }
    }
  });

  // fecha ao clicar fora
  document.addEventListener("click", (e) => {
    if (!isOpen) return;
    if (!root.contains(e.target)) close();
  });

  root.currentValue = () => (selected ? selected.id : null);
  root.currentText = () => (selected ? selected.text : "");
  root.setDisabled = (flag) => {
    disabled = flag;
    control.classList.toggle("disabled", !!flag);
    if (flag) close();
  };
  root.setPreset = (next) => setSelected(next && next.id ? { id: String(next.id), text: next.text || "" } : null);

  return root;
}
