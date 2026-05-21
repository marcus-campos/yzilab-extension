import { MSG, send } from "../../lib/messages.js";
import { el, openModal, toast, asyncSearchSelect } from "../../ui/components.js";

// Modal de mapeamento — espelha resolve_request.html do desktop.
//   - Clínica (asyncSearchSelect, paginado, com grupos clínica/encaminhamento)
//   - Veterinário (asyncSearchSelect filtrado por clínica; recriado ao trocar clínica)
//   - Espécie + Raça (asyncSearchSelect; raça filtrada pela espécie)
//   - Exames: 1 linha por exame externo
//   - Checkbox "Salvar estes vínculos" (default checked)
//   - Sempre abre, mesmo se totalmente mapeado, para revisão.
export function openMappingModal(item, { onProcessed }) {
  openModal(
    ({ body, close }) => {
      // Alert resumo do pet — esconde tokens vazios ou "Não informado"
      const summaryParts = [];
      if (isInformative(item.pet?.species)) summaryParts.push(item.pet.species);
      if (isInformative(item.pet?.breed_external_name)) summaryParts.push(item.pet.breed_external_name);
      if (item.pet?.tutor_name) summaryParts.push(`Tutor: ${item.pet.tutor_name}`);
      body.appendChild(
        el("div", { class: "alert-success" }, [
          el("strong", {}, item.pet?.name || "Sem nome"),
          summaryParts.length ? ` · ${summaryParts.join(" · ")}` : "",
        ])
      );

      // ─── Clínica ────
      body.appendChild(el("h4", { class: "modal-section" }, "Clínica *"));
      body.appendChild(
        el(
          "p",
          { class: "small muted modal-origin" },
          `Origem: ${item.clinic?.external_name || "-"}`
        )
      );
      const clinicSelect = asyncSearchSelect({
        placeholder: "Selecione…",
        fetchPage: ({ q, page }) => send(MSG.YZILAB_SEARCH_CLINICS, { q, page }),
        mapItem: (c) => ({
          id: c.id,
          text: c.fantasy_name || c.corporate_name || c.cnpj || c.id,
          group: c.is_referral ? "Clínicas de encaminhamento" : "Clínicas",
        }),
        preset: presetFrom(
          item.clinic_id || item.clinic_suggestion_id,
          item.clinic_name || item.clinic_suggestion_name
        ),
        onChange: () => rebuildVetSelect(),
      });
      body.appendChild(el("div", { class: "field" }, [clinicSelect]));

      // ─── Veterinário ────
      body.appendChild(el("h4", { class: "modal-section" }, "Veterinário"));
      const vetOriginText = item.veterinary?.external_name
        ? `${item.veterinary.external_name}${item.veterinary.external_crmv ? " (" + item.veterinary.external_crmv + ")" : ""}`
        : "-";
      body.appendChild(el("p", { class: "small muted modal-origin" }, `Origem: ${vetOriginText}`));
      const vetWrapper = el("div", {});
      let vetSelect = null;
      // No mount inicial usa o preset enriquecido do backend; ao trocar de
      // clínica o vet anterior é de outra clínica e não faz mais sentido —
      // limpa.
      function rebuildVetSelect({ keepInitialPreset = false } = {}) {
        const clinicId = clinicSelect.currentValue();
        const initialPreset = presetFrom(
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
          preset: keepInitialPreset && initialPreset ? initialPreset : null,
          allowClear: true,
          disabled: !clinicId,
        });
        vetWrapper.replaceChildren(next);
        vetSelect = next;
      }
      rebuildVetSelect({ keepInitialPreset: true });
      body.appendChild(el("div", { class: "field" }, [vetWrapper]));

      // ─── Raça / Espécie (a espécie vem implícita pela FK Breed.specie) ────
      body.appendChild(el("h4", { class: "modal-section" }, "Raça / Espécie *"));
      const breedOriginParts = [];
      if (isInformative(item.pet?.species)) breedOriginParts.push(item.pet.species);
      if (isInformative(item.pet?.breed_external_name)) breedOriginParts.push(item.pet.breed_external_name);
      body.appendChild(
        el(
          "p",
          { class: "small muted modal-origin" },
          `Origem: ${breedOriginParts.length ? breedOriginParts.join(" · ") : "-"}`
        )
      );
      const breedPreset = pickBreedPreset(item);
      const breedSelect = asyncSearchSelect({
        placeholder: "Selecione…",
        fetchPage: ({ q, page }) => send(MSG.YZILAB_SEARCH_BREEDS, { q, page }),
        mapItem: (b) => ({
          id: b.id,
          text: b.name,
          group: b.specie_name || "Outros",
        }),
        preset: breedPreset,
      });
      body.appendChild(el("div", { class: "field" }, [breedSelect]));

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
        const breedId = breedSelect && breedSelect.currentValue();
        if (!breedId) {
          toast("Selecione a raça", { type: "error" });
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
            breedId,
            saveMappings: saveMappingsCheckbox.checked,
          });
          toast(`Pedido criado: protocolo ${result.protocol}`, { type: "success" });
          close();
          onProcessed && onProcessed(result);
        } catch (err) {
          statusLine.textContent = "";
          toast(err.message || "Erro ao importar requisição", { type: "error", duration: 7000 });
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

// Pré-seleção da raça:
//  1) breed_id (mapping salvo) — sempre pré-seleciona
//  2) breed_suggestion_id — pré-seleciona EXCETO quando a raça externa é vazia,
//     "não informado" ou variação de SRD (chute do sistema nesses casos não ajuda).
const UNINFORMATIVE_BREED_NAMES = new Set([
  "",
  "nao informado",
  "não informado",
  "sem informacao",
  "sem informação",
  "srd",
  "sem raca definida",
  "sem raça definida",
  "indefinida",
  "indefinido",
]);

function isInformative(value) {
  const norm = (value || "").trim().toLowerCase();
  return norm !== "" && !UNINFORMATIVE_BREED_NAMES.has(norm);
}

function pickBreedPreset(item) {
  if (item.breed_id) {
    return presetFrom(item.breed_id, item.breed_name);
  }
  if (!isInformative(item.pet?.breed_external_name)) return null;
  if (item.breed_suggestion_id) {
    return presetFrom(item.breed_suggestion_id, item.breed_suggestion_name);
  }
  return null;
}
