import { MSG, send } from "../../lib/messages.js";
import { el, openModal, toast, asyncSearchSelect } from "../../ui/components.js";

export function openMappingModal(item, { onProcessed }) {
  openModal(
    ({ body, close }) => {
      const summaryAlert = el("div", { class: "alert-success" });
      const summaryTextWrap = el("div", { class: "summary-text" });
      const refreshPetBtn = el(
        "button",
        { class: "ghost small-btn pet-refresh", title: "Buscar dados completos do paciente na Petlove" },
        "↻ Atualizar"
      );
      if (!item.pet?.microchip) refreshPetBtn.disabled = true;
      summaryAlert.appendChild(summaryTextWrap);
      summaryAlert.appendChild(refreshPetBtn);
      body.appendChild(summaryAlert);
      renderPetSummary();

      async function refreshPet({ silent = false } = {}) {
        if (!item.pet?.microchip) return;
        refreshPetBtn.disabled = true;
        const original = refreshPetBtn.textContent;
        refreshPetBtn.textContent = "buscando…";
        try {
          const detail = await send(MSG.PETLOVE_GET_PET_DETAIL, { microchip: item.pet.microchip });
          applyPetDetail(detail);
          renderPetSummary();
          renderBreedOrigin();
          await tryPreselectBreedByName(item.pet?.breed_external_name);
          if (!silent) toast("Dados do paciente atualizados", { type: "success" });
        } catch (err) {
          if (!silent) toast(err.message || "Falha ao atualizar paciente", { type: "error" });
        } finally {
          refreshPetBtn.textContent = original;
          refreshPetBtn.disabled = !item.pet?.microchip;
        }
      }

      refreshPetBtn.addEventListener("click", () => refreshPet({ silent: false }));

      if (item.pet?.microchip) {
        Promise.resolve().then(() => refreshPet({ silent: true }));
      }

      function renderPetSummary() {
        const summaryParts = [];
        if (isInformative(item.pet?.species)) summaryParts.push(item.pet.species);
        if (isInformative(item.pet?.breed_external_name)) summaryParts.push(item.pet.breed_external_name);
        if (item.pet?.tutor_name) summaryParts.push(`Tutor: ${item.pet.tutor_name}`);
        summaryTextWrap.replaceChildren(
          el("strong", {}, item.pet?.name || "Sem nome"),
          ...(summaryParts.length ? [document.createTextNode(` · ${summaryParts.join(" · ")}`)] : [])
        );
      }

      function applyPetDetail(detail) {
        if (!detail || typeof detail !== "object") return;
        if (!item.pet) item.pet = {};
        if (detail.name) item.pet.name = detail.name;
        if (detail.microchip) item.pet.microchip = detail.microchip;
        if (detail.sex) item.pet.sex = detail.sex;
        if (detail.birthday) item.pet.birthday = detail.birthday;
        if (detail.user_name) item.pet.tutor_name = detail.user_name;
        if (detail.user_phone) item.pet.tutor_phone = detail.user_phone;
        if (detail.race) {
          if (detail.race.name) item.pet.breed_external_name = detail.race.name;
          if (detail.race.id != null) item.pet.breed_external_id = String(detail.race.id);
          if (detail.race.specie?.name) item.pet.species = detail.race.specie.name;
        }
      }

      async function tryPreselectBreedByName(name) {
        if (!isInformative(name)) return;
        try {
          const result = await send(MSG.YZILAB_SEARCH_BREEDS, { q: name, page: 1, pageSize: 10 });
          const items = (result && result.results) || [];
          const target = name.trim().toLowerCase();
          const exact = items.find((b) => (b.name || "").trim().toLowerCase() === target);
          if (exact && breedSelect) {
            breedSelect.setPreset({ id: String(exact.id), text: exact.name });
          }
        } catch {
          /* best-effort */
        }
      }

      body.appendChild(el("h4", { class: "modal-section" }, "Clínica *"));
      body.appendChild(
        el("p", { class: "small muted modal-origin" }, `Origem: ${item.clinic?.external_name || "-"}`)
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

      body.appendChild(el("h4", { class: "modal-section" }, "Veterinário"));
      const vetOriginText = item.veterinary?.external_name
        ? `${item.veterinary.external_name}${item.veterinary.external_crmv ? " (" + item.veterinary.external_crmv + ")" : ""}`
        : "-";
      body.appendChild(el("p", { class: "small muted modal-origin" }, `Origem: ${vetOriginText}`));
      const vetWrapper = el("div", {});
      let vetSelect = null;
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

      body.appendChild(el("h4", { class: "modal-section" }, "Raça / Espécie *"));
      const breedOriginEl = el("p", { class: "small muted modal-origin" }, "");
      body.appendChild(breedOriginEl);
      function renderBreedOrigin() {
        const parts = [];
        if (isInformative(item.pet?.species)) parts.push(item.pet.species);
        if (isInformative(item.pet?.breed_external_name)) parts.push(item.pet.breed_external_name);
        breedOriginEl.textContent = `Origem: ${parts.length ? parts.join(" · ") : "-"}`;
      }
      renderBreedOrigin();
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
          mapItem: (e) => ({
            id: e.id,
            text: e.category_name ? `${e.name} — ${e.category_name}` : e.name,
            group: e.category_name || "Outros",
          }),
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

      const saveMappingsCheckbox = el("input", { type: "checkbox", id: "save-mappings", checked: true });
      const saveMappingsRow = el("div", { class: "checkbox-row" }, [
        saveMappingsCheckbox,
        el("label", { for: "save-mappings" }, " Salvar estes vínculos para próximas solicitações"),
      ]);
      body.appendChild(saveMappingsRow);

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
