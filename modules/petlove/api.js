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

export async function acceptRequest(session, requestId) {
  const { data } = await request(`${BASE}/api/requests-evaluation/${requestId}/accept`, {
    method: "POST",
    headers: authHeaders(session),
    body: { partialRefuse: [], refusalReason: "" },
    credentials: "include",
  });
  return data;
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
  const { data } = await request(`${BASE}/api/requests-evaluation/${requestId}/complete`, {
    method: "POST",
    headers: authHeaders(session),
    body: form,
    asFormData: true,
    credentials: "include",
    timeoutMs: 60000,
  });
  return data;
}

function b64ToBytes(b64) {
  const bin = atob(b64);
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
