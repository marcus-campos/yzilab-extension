// Service worker MV3. Abre side panel ao clicar no ícone e roteia mensagens.
import { MSG, reply } from "../lib/messages.js";
import { local, session, KEYS, getSettings, setSettings } from "../lib/storage.js";
import { log } from "../lib/logger.js";
import * as yzilab from "../lib/yzilab-client.js";
import * as petloveApi from "../modules/petlove/api.js";

const AUTO_SYNC_ALARM = "auto-sync-petlove";

chrome.runtime.onInstalled.addListener(async () => {
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    log.info("install: side panel set to open on action click");
  } catch (err) {
    log.error("install: failed to set side panel behavior", err);
  }
  await applyAutoSyncSchedule();
});

chrome.runtime.onStartup.addListener(async () => {
  await applyAutoSyncSchedule();
});

// Fallback se algum browser ignorar setPanelBehavior — clicar no ícone abre o painel.
chrome.action.onClicked.addListener(async (tab) => {
  try {
    await chrome.sidePanel.open({ windowId: tab.windowId });
  } catch (err) {
    log.warn("action.onClicked: sidePanel.open failed", err);
  }
});

// ─── Petlove session ───────────────────────────────────────────────────────
// A autenticação real é via cookie `health_partners_session` (anexado automaticamente
// quando o fetch usa credentials:'include'). CSRF segue padrão Laravel: cookie
// XSRF-TOKEN é decodificado e ecoado no header X-XSRF-TOKEN.
// access_token (Bearer) é opcional — só usado se existir como cookie ou se o
// content script tiver capturado de localStorage.

const PETLOVE_PORTAL_URL = "https://central-de-saude.petlove.com.br/";

async function readPetloveCookie(name) {
  try {
    const cookie = await chrome.cookies.get({ url: PETLOVE_PORTAL_URL, name });
    return cookie ? cookie.value : null;
  } catch (err) {
    log.warn(`chrome.cookies.get failed for ${name}`, err);
    return null;
  }
}

async function readPetloveCookieSession() {
  const [healthSession, xsrfRaw, userCookieRaw, accessTokenCookie] = await Promise.all([
    readPetloveCookie("health_partners_session"),
    readPetloveCookie("XSRF-TOKEN"),
    readPetloveCookie("user"),
    readPetloveCookie("access_token"),
  ]);
  let xsrf = null;
  if (xsrfRaw) {
    try {
      xsrf = decodeURIComponent(xsrfRaw);
    } catch {
      xsrf = xsrfRaw;
    }
  }
  // O cookie `user` na central-de-saude.petlove.com.br é JSON URI-encoded:
  //   {"token_type":"Bearer","access_token":"…","user_id":…,…}
  let accessFromUserCookie = null;
  let tokenType = null;
  let userId = null;
  if (userCookieRaw) {
    try {
      const parsed = JSON.parse(decodeURIComponent(userCookieRaw));
      accessFromUserCookie = parsed.access_token || null;
      tokenType = parsed.token_type || null;
      userId = parsed.user_id || parsed.id || null;
    } catch (err) {
      log.warn("falha ao parsear cookie 'user'", err);
    }
  }
  return {
    has_session_cookie: !!healthSession,
    xsrf_token: xsrf,
    access_token_from_cookie: accessTokenCookie || accessFromUserCookie,
    token_type: tokenType,
    user_id: userId,
  };
}

// Vem do content script (caso a Petlove guarde access_token em localStorage).
// Em produção pode não ser necessário — o cookie sozinho costuma autenticar.
async function handlePetloveSession(payload) {
  const next = {
    access_token: payload.access_token || null,
    xsrf_token: payload.xsrf_token || null,
    captured_at: payload.captured_at || Date.now(),
    user_id: payload.user_id || null,
  };
  const prev = (await session.get(KEYS.PETLOVE_SESSION)) || {};
  const merged = {
    access_token: next.access_token || prev.access_token,
    xsrf_token: next.xsrf_token || prev.xsrf_token,
    captured_at: next.captured_at,
    user_id: next.user_id || prev.user_id,
  };
  await session.set(KEYS.PETLOVE_SESSION, merged);
  log.info("petlove session captured from content script", {
    has_access: !!merged.access_token,
    has_xsrf: !!merged.xsrf_token,
  });
  return { stored: true };
}

async function getPetloveSession() {
  const cookieSess = await readPetloveCookieSession();
  if (!cookieSess.has_session_cookie) {
    throw new Error(
      "no_petlove_session: cookie health_partners_session ausente. Abra central-de-saude.petlove.com.br e faça login."
    );
  }
  const fromScript = (await session.get(KEYS.PETLOVE_SESSION)) || {};
  return {
    access_token: cookieSess.access_token_from_cookie || fromScript.access_token || null,
    xsrf_token: cookieSess.xsrf_token || fromScript.xsrf_token || null,
    token_type: cookieSess.token_type || "Bearer",
    has_session_cookie: true,
  };
}

async function getPetloveSessionInfo() {
  const cookieSess = await readPetloveCookieSession();
  const fromScript = (await session.get(KEYS.PETLOVE_SESSION)) || {};
  const access = cookieSess.access_token_from_cookie || fromScript.access_token || null;
  return {
    has_session_cookie: cookieSess.has_session_cookie,
    has_xsrf: !!cookieSess.xsrf_token,
    has_access_token: !!access,
    access_source: cookieSess.access_token_from_cookie
      ? "cookie"
      : fromScript.access_token
        ? "localstorage"
        : null,
    captured_at: fromScript.captured_at || null,
    access_preview: access ? access.slice(0, 12) + "…" : null,
  };
}

// ─── Cache do HealthInsurance "Petlove" ────────────────────────────────────
async function resolvePetloveHealthInsuranceId() {
  let cached = await local.get(KEYS.HEALTH_INSURANCE_PETLOVE);
  if (cached && cached.id) return cached.id;
  const all = await yzilab.listHealthInsurances();
  const found = all.find((hi) => (hi.fantasy_name || "").trim().toLowerCase() === "petlove");
  if (!found) throw new Error("Petlove não encontrado em /health-insurance/. Cadastre antes.");
  await local.set(KEYS.HEALTH_INSURANCE_PETLOVE, { id: found.id, fantasy_name: found.fantasy_name });
  return found.id;
}

// ─── Petlove inbox flow ────────────────────────────────────────────────────
async function fetchPetloveInbox(filters = {}) {
  const sess = await getPetloveSession();
  const raw = await petloveApi.listAllPending(sess, filters);
  log.info("petlove pending fetched", { count: raw.length });
  const hiId = await resolvePetloveHealthInsuranceId();
  const enriched = await yzilab.examRequestsFromExtension(hiId, raw);
  // anexa o raw correspondente para o process passar `normalized` (já enriquecido)
  return enriched.map((item) => ({
    ...item,
    health_insurance_id: hiId,
  }));
}

async function processPetloveRequest({ externalRequestId, normalized, clinicId, veterinaryId, examMappings, breedId, saveMappings }) {
  const hiId = await resolvePetloveHealthInsuranceId();
  // remover campos extras de enrichment antes de mandar como normalized
  const cleanNormalized = stripEnrichment(normalized);
  return yzilab.processExamRequest(hiId, externalRequestId, {
    clinicId,
    veterinaryId,
    examMappings,
    breedId,
    saveMappings,
    normalized: cleanNormalized,
  });
}

function stripEnrichment(normalized) {
  if (!normalized) return null;
  const {
    clinic_id, clinic_name, clinic_suggestion_id, clinic_suggestion_name,
    veterinary_id, veterinary_name, veterinary_suggestion_id, veterinary_suggestion_name,
    breed_id, breed_name, breed_suggestion_id, breed_suggestion_name,
    specie_id, specie_name, specie_suggestion_id, specie_suggestion_name,
    already_processed, health_insurance_id,
    exams,
    ...rest
  } = normalized;
  const cleanExams = (exams || []).map((ex) => ({
    external_id: ex.external_id,
    external_name: ex.external_name,
  }));
  return { ...rest, exams: cleanExams };
}

// ─── Petlove result push ───────────────────────────────────────────────────
async function pushOneResult({ mappingIds, externalRequestId, attachments }) {
  const sess = await getPetloveSession();
  try {
    await petloveApi.acceptRequest(sess, externalRequestId);
    const acceptedAt = new Date().toISOString();
    await yzilab.resultPushConfirm({
      mappingIds,
      externalRequestId,
      acceptedAt,
    });

    await petloveApi.completeRequest(sess, externalRequestId, attachments);
    const completedAt = new Date().toISOString();
    await yzilab.resultPushConfirm({
      mappingIds,
      externalRequestId,
      acceptedAt,
      completedAt,
    });
    return { ok: true, externalRequestId };
  } catch (err) {
    await yzilab.resultPushConfirm({
      mappingIds,
      externalRequestId,
      error: err && err.message ? err.message : String(err),
    });
    throw err;
  }
}

// ─── Auto-sync (modo automático via chrome.alarms) ─────────────────────────
const autoSyncState = {
  running: false,
  lastRunAt: null,
  lastResult: null, // { processed, failed, errors: [...] }
};

async function applyAutoSyncSchedule() {
  try {
    const settings = await getSettings();
    await chrome.alarms.clear(AUTO_SYNC_ALARM);
    if (settings.autoSyncEnabled) {
      const period = Number(settings.autoSyncIntervalMinutes) || 15;
      await chrome.alarms.create(AUTO_SYNC_ALARM, { periodInMinutes: period, delayInMinutes: 1 });
      log.info(`auto-sync schedule armed: every ${period} min`);
    } else {
      log.info("auto-sync schedule cleared (setting off)");
    }
  } catch (err) {
    log.error("applyAutoSyncSchedule failed", err);
  }
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== AUTO_SYNC_ALARM) return;
  const settings = await getSettings();
  if (!settings.autoSyncEnabled) return;
  await runAutoSyncRound("alarm");
});

async function runAutoSyncRound(triggerReason = "manual") {
  if (autoSyncState.running) {
    log.info(`auto-sync skip: already running (trigger=${triggerReason})`);
    return autoSyncState.lastResult;
  }
  autoSyncState.running = true;
  const startedAt = new Date().toISOString();
  let processed = 0;
  let failed = 0;
  const errors = [];

  try {
    // requer sessão Petlove
    try {
      await getPetloveSession();
    } catch (err) {
      log.warn(`auto-sync abort: ${err.message}`);
      autoSyncState.lastResult = { startedAt, processed: 0, failed: 0, errors: [err.message], aborted: true };
      autoSyncState.lastRunAt = startedAt;
      return autoSyncState.lastResult;
    }

    const queue = await yzilab.resultPushQueue({});
    log.info(`auto-sync (${triggerReason}): ${queue.length} item(s) na fila`);
    for (const item of queue) {
      try {
        await pushOneResult({
          mappingIds: item.mapping_ids,
          externalRequestId: item.external_request_id,
          attachments: item.attachments,
        });
        processed += 1;
      } catch (err) {
        failed += 1;
        errors.push(`${item.external_request_id}: ${err.message}`);
      }
    }
    autoSyncState.lastResult = { startedAt, processed, failed, errors };
    autoSyncState.lastRunAt = startedAt;
    log.info(`auto-sync done: processed=${processed} failed=${failed}`);
    return autoSyncState.lastResult;
  } finally {
    autoSyncState.running = false;
  }
}

function getAutoSyncStatus(settings) {
  return {
    enabled: !!settings.autoSyncEnabled,
    intervalMinutes: settings.autoSyncIntervalMinutes || 15,
    running: autoSyncState.running,
    lastRunAt: autoSyncState.lastRunAt,
    lastResult: autoSyncState.lastResult,
  }
}

// ─── Message routing ───────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { type, payload } = message || {};

  switch (type) {
    case MSG.PETLOVE_SESSION_CAPTURED:
      return reply(sendResponse, () => handlePetloveSession(payload || {}));

    case MSG.PETLOVE_GET_SESSION_INFO:
      return reply(sendResponse, () => getPetloveSessionInfo());

    case MSG.PETLOVE_FETCH_INBOX:
      return reply(sendResponse, () => fetchPetloveInbox(payload || {}));

    case MSG.PETLOVE_PROCESS_REQUEST:
      return reply(sendResponse, () => processPetloveRequest(payload || {}));

    case MSG.PETLOVE_PUSH_RESULT:
      return reply(sendResponse, () => pushOneResult(payload || {}));

    case MSG.YZILAB_LOGIN:
      return reply(sendResponse, () => yzilab.login(payload.email, payload.password));

    case MSG.YZILAB_LOGOUT:
      return reply(sendResponse, () => yzilab.logout());

    case MSG.YZILAB_GET_USER:
      return reply(sendResponse, () => yzilab.getUser());

    case MSG.YZILAB_LIST_HEALTH_INSURANCES:
      return reply(sendResponse, () => yzilab.listHealthInsurances());

    case MSG.YZILAB_SEARCH_CLINICS:
      return reply(sendResponse, () => yzilab.searchClinics(payload || {}));

    case MSG.YZILAB_SEARCH_EXAMS:
      return reply(sendResponse, () => yzilab.searchExams(payload || {}));

    case MSG.YZILAB_SEARCH_VETERINARIES:
      return reply(sendResponse, () => yzilab.searchVeterinaries(payload || {}));

    case MSG.YZILAB_SEARCH_SPECIES:
      return reply(sendResponse, () => yzilab.searchSpecies(payload || {}));

    case MSG.YZILAB_SEARCH_BREEDS:
      return reply(sendResponse, () => yzilab.searchBreeds(payload || {}));

    case MSG.YZILAB_RESULT_PUSH_QUEUE:
      return reply(sendResponse, () => yzilab.resultPushQueue(payload || {}));

    case MSG.YZILAB_RESULT_SYNC_LIST:
      return reply(sendResponse, () => yzilab.listResultSync(payload || {}));

    case MSG.AUTO_SYNC_RUN_NOW:
      return reply(sendResponse, () => runAutoSyncRound("manual"));

    case MSG.AUTO_SYNC_STATUS:
      return reply(sendResponse, async () => getAutoSyncStatus(await getSettings()));

    case MSG.GET_SETTINGS:
      return reply(sendResponse, () => getSettings());

    case MSG.SET_SETTINGS:
      return reply(sendResponse, async () => {
        const merged = await setSettings(payload || {});
        await applyAutoSyncSchedule();
        return merged;
      });

    default:
      sendResponse({ ok: false, error: `unknown message type: ${type}` });
      return false;
  }
});
