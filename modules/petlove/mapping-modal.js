import { MSG, send } from "../../lib/messages.js";
import { el, openModal, toast, asyncSearchSelect } from "../../ui/components.js";

// Modal de mapeamento — espelha resolve_request.html do desktop.
//   - Clínica (asyncSearchSelect, paginado)
//   - Veterinário (asyncSearchSelect filtrado por clínica selecionada, recriado ao trocar clínica)
//   - Exames: 1 linha por exame externo, cada uma com asyncSearchSelect
//   - Checkbox "Salvar estes vínculos" (default checked)
//   - Sempre abre, mesmo se totalmente mapeado, para revisão.
export function openMappingModal(item, { onProcessed }) {
  openModal(
    ({ body, close }) => {
      // Alert resumo do pet
      const petSummary = el(
        "div",
        { class: "alert-success" },
        [
          el("strong", {}, item.pet?.name || "Sem nome"),
          " · ",
          (item.pet?.species || "—"),
          item.pet?.breed_external_name ? ` · ${item.pet.breed_external_name}` : "",
          item.pet?.tutor_name ? ` · Tutor: ${item.pet.tutor_name}` : "",
        ]
      );
      body.appendChild(petSummary);

      // ─── Clínica ────
      body.appendChild(el("h4", { class: "modal-section" }, "Clínica"));
      body.appendChild(
        el(
          "p",
          { class: "small muted modal-origin" },
          `Origem: ${item.clinic?.external_name || "-"}`
        )
      );
      const clinicLabel = el("label", {}, "Vincular à clínica *");
      const clinicSelect = asyncSearchSelect({
        placeholder: "Selecione…",
        fetchPage: ({ q, page }) => send(MSG.YZILAB_SEARCH_CLINICS, { q, page }),
        mapItem: (c) => ({
          id: c.id,
          text: c.cnpj ? `${c.fantasy_name} (${c.cnpj})` : c.fantasy_name,
        }),
        preset: presetFrom(item.clinic_id || item.clinic_suggestion_id, item.clinic_name || item.clinic_suggestion_name),
        onChange: () => rebuildVetSelect(),
      });
      body.appendChild(el("div", { class: "field" }, [clinicLabel, clinicSelect]));

      // ─── Veterinário ────
      body.appendChild(el("h4", { class: "modal-section" }, "Veterinário"));
      const vetOriginText = item.veterinary?.external_name
        ? `${item.veterinary.external_name}${item.veterinary.external_crmv ? " (" + item.veterinary.external_crmv + ")" : ""}`
        : "-";
      body.appendChild(el("p", { class: "small muted modal-origin" }, `Origem: ${vetOriginText}`));
      const vetLabel = el("label", {}, "Vincular ao veterinário");
      const vetWrapper = el("div", {});
      let vetSelect = null;
      function rebuildVetSelect() {
        const clinicId = clinicSelect.currentValue();
        const oldPreset = vetSelect
          ? { id: vetSelect.currentValue(), text: vetSelect.currentText() }
          : presetFrom(
              item.veterinary_id || item.veterinary_suggestion_id,
              item.veterinary_name || item.veterinary_suggestion_name
            );
        const next = asyncSearchSelect({
          placeholder: clinicId ? "Selecione (opcional)…" : "Selecione uma clínica primeiro",
          fetchPage: ({ q, page }) => send(MSG.YZILAB_SEARCH_VETERINARIES, { q, page, clinicId }),
          mapItem: (v) => ({
            id: v.id,
            text: v.crmv ? `${v.name} (${v.crmv})` : v.name,
          }),
          preset: oldPreset && oldPreset.id ? oldPreset : null,
          allowClear: true,
          disabled: !clinicId,
        });
        vetWrapper.replaceChildren(next);
        vetSelect = next;
      }
      rebuildVetSelect();
      body.appendChild(el("div", { class: "field" }, [vetLabel, vetWrapper]));

      // ─── Exames ────
      body.appendChild(el("h4", { class: "modal-section" }, "Exames"));
      body.appendChild(
        el("p", { class: "small muted modal-origin" }, "Vincule cada exame solicitado a um exame.")
      );
      const examTable = el("table", { class: "data exam-map-table" });
      examTable.appendChild(
        el("thead", {}, el("tr", {}, [el("th", {}, "Exame solicitado"), el("th", {}, "Exame *")]))
      );
      const examTbody = el("tbody", {});
      examTable.appendChild(examTbody);
      const examSelectByExternal = new Map();
      for (const exam of item.exams || []) {
        const sel = asyncSearchSelect({
          placeholder: "Selecione…",
          fetchPage: ({ q, page }) => send(MSG.YZILAB_SEARCH_EXAMS, { q, page }),
          mapItem: (e) => ({ id: e.id, text: e.name }),
          preset: presetFrom(
            exam.exam_id || exam.exam_suggestion_id,
            exam.exam_name || exam.exam_suggestion_name
          ),
        });
        examSelectByExternal.set(exam.external_id, sel);
        examTbody.appendChild(
          el("tr", {}, [
            el("td", {}, el("strong", {}, exam.external_name || exam.external_id)),
            el("td", {}, sel),
          ])
        );
      }
      body.appendChild(examTable);

      // ─── Salvar vínculos ────
      const saveMappingsCheckbox = el("input", { type: "checkbox", id: "save-mappings", checked: true });
      const saveMappingsRow = el("div", { class: "checkbox-row" }, [
        saveMappingsCheckbox,
        el("label", { for: "save-mappings" }, " Salvar estes vínculos para próximas solicitações"),
      ]);
      body.appendChild(saveMappingsRow);

      // ─── Footer ────
      const cancelBtn = el("button", { class: "ghost" }, "Cancelar");
      const submitBtn = el("button", { class: "primary" }, "Importar requisição");
      const statusLine = el("div", { class: "small muted modal-status" }, "");
      body.appendChild(statusLine);
      const footer = el("div", { class: "actions" }, [cancelBtn, submitBtn]);
      body.appendChild(footer);

      cancelBtn.addEventListener("click", close);

      submitBtn.addEventListener("click", async () => {
        const clinicId = clinicSelect.currentValue();
        if (!clinicId) {
          toast("Selecione a clínica", { type: "error" });
          return;
        }
        const examMappings = [];
        for (const exam of item.exams || []) {
          const sel = examSelectByExternal.get(exam.external_id);
          const examId = sel && sel.currentValue();
          if (!examId) {
            toast(`Mapeie o exame: ${exam.external_name || exam.external_id}`, { type: "error" });
            return;
          }
          examMappings.push({ external_id: exam.external_id, exam_id: examId });
        }

        submitBtn.disabled = true;
        cancelBtn.disabled = true;
        statusLine.textContent = "processando…";
        try {
          const result = await send(MSG.PETLOVE_PROCESS_REQUEST, {
            externalRequestId: item.external_request_id,
            normalized: item,
            clinicId,
            veterinaryId: (vetSelect && vetSelect.currentValue()) || null,
            examMappings,
            saveMappings: saveMappingsCheckbox.checked,
          });
          toast(`Pedido criado: protocolo ${result.protocol}`, { type: "success" });
          close();
          onProcessed && onProcessed(result);
        } catch (err) {
          statusLine.textContent = "";
          toast(`Falha: ${err.message}`, { type: "error", duration: 6000 });
          submitBtn.disabled = false;
          cancelBtn.disabled = false;
        }
      });
    },
    { title: "Importar solicitação" }
  );
}

function presetFrom(id, text) {
  if (!id) return null;
  return { id: String(id), text: text || String(id) };
}
