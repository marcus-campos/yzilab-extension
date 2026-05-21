// Cliente HTTP YziLab core. Faz login, refresh automático e wraps de endpoints usados pela extensão.
import { request } from "./http.js";
import { local, KEYS, getSettings } from "./storage.js";
import { log } from "./logger.js";

const REFRESH_LEEWAY_SECONDS = 60;

function decodeJwtExp(jwt) {
  try {
    const [, payload] = jwt.split(".");
    const json = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    return json.exp || null;
  } catch {
    return null;
  }
}

async function apiBase() {
  const settings = await getSettings();
  return settings.yzilabBaseUrl.replace(/\/$/, "") + settings.yzilabApiPath;
}

async function readToken() {
  return (await local.get(KEYS.YZILAB_TOKEN)) || null;
}

async function writeToken(token) {
  await local.set(KEYS.YZILAB_TOKEN, token);
}

async function clearToken() {
  await local.remove(KEYS.YZILAB_TOKEN);
  await local.remove(KEYS.YZILAB_USER);
}

export async function login(email, password) {
  const base = await apiBase();
  const { data } = await request(`${base}/token/`, {
    method: "POST",
    body: { email, password },
  });
  const exp = decodeJwtExp(data.access);
  const token = { access: data.access, refresh: data.refresh, exp };
  await writeToken(token);
  if (data.user) await local.set(KEYS.YZILAB_USER, data.user);
  log.info("yzilab login ok", { email, exp });
  return { user: data.user, exp };
}

export async function logout() {
  await clearToken();
  log.info("yzilab logout");
}

export async function getUser() {
  return (await local.get(KEYS.YZILAB_USER)) || null;
}

async function refresh() {
  const token = await readToken();
  if (!token || !token.refresh) throw new Error("no refresh token");
  const base = await apiBase();
  try {
    const { data } = await request(`${base}/token/refresh/`, {
      method: "POST",
      body: { refresh: token.refresh },
    });
    const exp = decodeJwtExp(data.access);
    const next = { access: data.access, refresh: data.refresh || token.refresh, exp };
    await writeToken(next);
    log.info("yzilab token refreshed", { exp });
    return next;
  } catch (err) {
    log.warn("yzilab refresh failed — clearing token", err);
    await clearToken();
    throw err;
  }
}

async function getValidToken() {
  let token = await readToken();
  if (!token || !token.access) throw new Error("not authenticated");
  const now = Math.floor(Date.now() / 1000);
  if (token.exp && now > token.exp - REFRESH_LEEWAY_SECONDS) {
    token = await refresh();
  }
  return token.access;
}

async function authedRequest(path, opts = {}) {
  const access = await getValidToken();
  const base = await apiBase();
  const url = path.startsWith("http") ? path : `${base}${path}`;
  const headers = { ...(opts.headers || {}), Authorization: `Bearer ${access}` };

  try {
    return await request(url, { ...opts, headers });
  } catch (err) {
    if (err.status === 401) {
      try {
        const next = await refresh();
        headers.Authorization = `Bearer ${next.access}`;
        return await request(url, { ...opts, headers });
      } catch {
        await clearToken();
        throw new Error("session expired — please log in again");
      }
    }
    throw err;
  }
}

// ─── Endpoints ──────────────────────────────────────────────────────────────

export async function listHealthInsurances() {
  const { data } = await authedRequest(`/health-insurance/?page_size=100`);
  return data.results || data;
}

function buildPaginated(data, pageSize) {
  const results = data.results || data;
  const count = typeof data.count === "number" ? data.count : results.length;
  const totalPages = Math.max(1, Math.ceil(count / pageSize));
  return { results, count, totalPages };
}

export async function searchClinics({ q = "", page = 1, pageSize = 20 } = {}) {
  const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
  if (q) {
    params.set("filter_by", "search");
    params.set("q", q);
  }
  const { data } = await authedRequest(`/clinic/?${params.toString()}`);
  const { results, count, totalPages } = buildPaginated(data, pageSize);
  return { results, count, page, totalPages };
}

export async function searchExams({ q = "", page = 1, pageSize = 20 } = {}) {
  const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
  if (q) params.set("q", q);
  const { data } = await authedRequest(`/exam/?${params.toString()}`);
  const { results, count, totalPages } = buildPaginated(data, pageSize);
  return { results, count, page, totalPages };
}

export async function searchSpecies({ q = "", page = 1, pageSize = 50 } = {}) {
  const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
  if (q) params.set("q", q);
  const { data } = await authedRequest(`/patient/specie/?${params.toString()}`);
  const results = data.results || data;
  const count = typeof data.count === "number" ? data.count : results.length;
  const totalPages = Math.max(1, Math.ceil(count / pageSize));
  return { results, count, page, totalPages };
}

export async function searchBreeds({ q = "", specieId = null, page = 1, pageSize = 50 } = {}) {
  const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
  if (specieId) params.set("specie", specieId);
  if (q) params.set("q", q);
  const { data } = await authedRequest(`/patient/breed/?${params.toString()}`);
  const results = data.results || data;
  const count = typeof data.count === "number" ? data.count : results.length;
  const totalPages = Math.max(1, Math.ceil(count / pageSize));
  return { results, count, page, totalPages };
}

export async function searchVeterinaries({ q = "", clinicId = null, page = 1, pageSize = 20 } = {}) {
  const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
  if (clinicId) params.set("clinic", clinicId);
  if (q) {
    params.set("filter_by", "search");
    params.set("q", q);
  }
  const { data } = await authedRequest(`/veterinary/?${params.toString()}`);
  const { results, count, totalPages } = buildPaginated(data, pageSize);
  return { results, count, page, totalPages };
}

export async function examRequestsFromExtension(healthInsuranceId, rawRequests) {
  const { data } = await authedRequest(
    `/health-insurance/${healthInsuranceId}/exam-requests-from-extension/`,
    { method: "POST", body: { raw_requests: rawRequests } }
  );
  return data.results || [];
}

export async function processExamRequest(
  healthInsuranceId,
  externalId,
  { clinicId, veterinaryId, examMappings, normalized, saveMappings = true, breedId = null }
) {
  const { data } = await authedRequest(
    `/health-insurance/${healthInsuranceId}/exam-requests/${externalId}/process/`,
    {
      method: "POST",
      body: {
        clinic_id: clinicId,
        veterinary_id: veterinaryId,
        exam_mappings: examMappings,
        save_mappings: saveMappings,
        breed_id: breedId,
        normalized,
      },
    }
  );
  return data;
}

export async function resultPushQueue({ healthInsuranceId = null, limit = 50 } = {}) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (healthInsuranceId) params.set("health_insurance_id", healthInsuranceId);
  const { data } = await authedRequest(`/health-insurance/result-push-queue/?${params.toString()}`);
  return data.results || [];
}

export async function listResultSync({ status = "all", healthInsuranceId = null, page = 1, pageSize = 30 } = {}) {
  const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
  if (status && status !== "all") params.set("status", status);
  if (healthInsuranceId) params.set("health_insurance_id", healthInsuranceId);
  const { data } = await authedRequest(`/health-insurance/result-sync/?${params.toString()}`);
  const results = data.results || data;
  const count = typeof data.count === "number" ? data.count : results.length;
  const totalPages = Math.max(1, Math.ceil(count / pageSize));
  return { results, count, page, totalPages };
}

export async function resultPushConfirm({ mappingIds, externalRequestId, acceptedAt, completedAt, error }) {
  const { data } = await authedRequest(`/health-insurance/result-push-confirm/`, {
    method: "POST",
    body: {
      mapping_ids: mappingIds,
      external_request_id: externalRequestId,
      accepted_at: acceptedAt || null,
      completed_at: completedAt || null,
      error: error || null,
    },
  });
  return data;
}
