import { request } from "../../lib/http.js";

const BASE = "https://central-de-saude.petlove.com.br";

function authHeaders(session) {
  const headers = {};
  if (session.access_token) {
    const type = session.token_type || "Bearer";
    headers["Authorization"] = `${type} ${session.access_token}`;
  }
  if (session.xsrf_token) headers["X-XSRF-TOKEN"] = session.xsrf_token;
  return headers;
}

export async function listPending(session, { page = 1, perPage = 50, filters = {} } = {}) {
  const params = new URLSearchParams();
  params.set("status", "pending");
  params.set("page", String(page));
  params.set("perPage", String(perPage));
  if (filters.pet_name) params.set("petName", filters.pet_name);
  if (filters.microchip) params.set("numChip", filters.microchip);
  if (filters.customer_name) params.set("customerName", filters.customer_name);
  if (filters.customer_cpf) params.set("customerDocument", filters.customer_cpf);
  if (filters.date_from && filters.date_to) {
    params.append("dateRange[]", `${filters.date_from}T03:00:00.000Z`);
    params.append("dateRange[]", `${filters.date_to}T03:00:00.000Z`);
  }
  const { data } = await request(`${BASE}/api/v2/requests?${params.toString()}`, {
    method: "GET",
    headers: authHeaders(session),
    credentials: "include",
  });
  return data;
}

export async function listAllPending(session, filters = {}) {
  const PER_PAGE = 50;
  const MAX_PAGES = 50;
  const all = [];
  const seenIds = new Set();
  let page = 1;
  while (page <= MAX_PAGES) {
    const result = await listPending(session, { page, perPage: PER_PAGE, filters });
    const items = Array.isArray(result) ? result : result.data || [];
    let fresh = 0;
    for (const item of items) {
      const key = item && item.id != null ? String(item.id) : null;
      if (key && seenIds.has(key)) continue;
      if (key) seenIds.add(key);
      all.push(item);
      fresh += 1;
    }
    const meta = (result && result.meta) || {};
    if (meta.current_page && meta.last_page) {
      if (meta.current_page >= meta.last_page) break;
    } else if (items.length < PER_PAGE || fresh === 0) {
      break;
    }
    page += 1;
  }
  return all;
}

export async function getRequestDetail(session, requestId) {
  const { data } = await request(`${BASE}/api/v2/requests/${requestId}`, {
    method: "GET",
    headers: authHeaders(session),
    credentials: "include",
  });
  return data;
}

export async function getPetDetail(session, microchip) {
  if (!microchip) throw new Error("microchip ausente");
  const { data } = await request(
    `${BASE}/api/atendimento/${encodeURIComponent(microchip)}`,
    {
      method: "GET",
      headers: authHeaders(session),
      credentials: "include",
    }
  );
  return data;
}

const ACCEPT_TOLERATED_STATUS = new Set([400, 404, 409, 422]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function getRequestStatus(session, requestId) {
  const params = new URLSearchParams();
  params.set("page", "1");
  params.set("perPage", "10");
  params.set("treatmentId", String(requestId));
  const { data } = await request(`${BASE}/api/v2/requests?${params.toString()}`, {
    method: "GET",
    headers: authHeaders(session),
    credentials: "include",
  });
  const items = (data && data.data) || [];
  const found = items.find((it) => String(it.id) === String(requestId)) || items[0] || null;
  return found ? found.status : null;
}

export async function acceptRequest(session, requestId, { maxRetries = 2, retryDelayMs = 3000 } = {}) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const { data } = await request(`${BASE}/api/requests-evaluation/${requestId}/accept`, {
        method: "POST",
        headers: authHeaders(session),
        body: { partialRefuse: [], refusalReason: "" },
        credentials: "include",
      });
      return { ok: true, data };
    } catch (err) {
      if (!err || !ACCEPT_TOLERATED_STATUS.has(err.status)) throw err;

      const status = await getRequestStatus(session, requestId).catch(() => null);
      if (status && status !== "pending") {
        return { ok: true, already_processed: true, status };
      }

      if (attempt < maxRetries) {
        await sleep(retryDelayMs);
        continue;
      }
      throw err;
    }
  }
}

export async function completeRequest(session, requestId, attachments) {
  if (!attachments || attachments.length === 0) {
    throw new Error("No attachments to send to Petlove.");
  }
  const form = new FormData();
  form.append("customUrl", "");
  form.append("description", "");
  form.append("isPartial", "false");
  for (const att of attachments) {
    const bytes = b64ToBytes(att.base64_content);
    const file = new File([bytes], att.name, { type: att.mimetype || "application/pdf" });
    form.append("results[]", file);
  }
  try {
    const { data } = await request(`${BASE}/api/requests-evaluation/${requestId}/complete`, {
      method: "POST",
      headers: authHeaders(session),
      body: form,
      asFormData: true,
      credentials: "include",
      timeoutMs: 60000,
    });
    return data;
  } catch (err) {
    // O complete pode falhar (timeout, reenvio, "No query results for model
    // [UserPetTreatment]") mesmo já tendo concluído no lado da Petlove. Confirma o
    // estado real antes de propagar — mesmo padrão do acceptRequest. "finished" é o
    // status terminal da Petlove (laudo anexado).
    const status = await getRequestStatus(session, requestId).catch(() => null);
    if (status === "finished") {
      return { ok: true, already_completed: true, status };
    }
    throw err;
  }
}

function b64ToBytes(b64) {
  const bin = atob(b64);
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
