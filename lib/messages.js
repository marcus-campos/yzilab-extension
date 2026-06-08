// Constantes de mensagens trocadas entre sidepanel, content scripts e service worker.

export const MSG = {
  // content script (petlove.com.br) -> service worker
  PETLOVE_SESSION_CAPTURED: "PETLOVE_SESSION_CAPTURED",

  // sidepanel -> service worker (Petlove)
  PETLOVE_FETCH_INBOX: "PETLOVE_FETCH_INBOX",
  PETLOVE_PROCESS_REQUEST: "PETLOVE_PROCESS_REQUEST",
  PETLOVE_PUSH_RESULT: "PETLOVE_PUSH_RESULT",
  PETLOVE_GET_SESSION_INFO: "PETLOVE_GET_SESSION_INFO",
  PETLOVE_GET_PET_DETAIL: "PETLOVE_GET_PET_DETAIL",

  // sidepanel -> service worker (YziLab)
  YZILAB_LOGIN: "YZILAB_LOGIN",
  YZILAB_LOGOUT: "YZILAB_LOGOUT",
  YZILAB_GET_USER: "YZILAB_GET_USER",
  YZILAB_LIST_HEALTH_INSURANCES: "YZILAB_LIST_HEALTH_INSURANCES",
  YZILAB_SEARCH_CLINICS: "YZILAB_SEARCH_CLINICS",
  YZILAB_SEARCH_EXAMS: "YZILAB_SEARCH_EXAMS",
  YZILAB_SEARCH_VETERINARIES: "YZILAB_SEARCH_VETERINARIES",
  YZILAB_SEARCH_SPECIES: "YZILAB_SEARCH_SPECIES",
  YZILAB_SEARCH_BREEDS: "YZILAB_SEARCH_BREEDS",
  YZILAB_RESULT_PUSH_QUEUE: "YZILAB_RESULT_PUSH_QUEUE",
  YZILAB_RESULT_SYNC_LIST: "YZILAB_RESULT_SYNC_LIST",

  // auto-sync
  AUTO_SYNC_RUN_NOW: "AUTO_SYNC_RUN_NOW",
  AUTO_SYNC_STATUS: "AUTO_SYNC_STATUS",

  // settings
  GET_SETTINGS: "GET_SETTINGS",
  SET_SETTINGS: "SET_SETTINGS",
};

export function send(type, payload = {}) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type, payload }, (response) => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message));
        return;
      }
      if (response && response.ok === false) {
        reject(new Error(response.error || "unknown error"));
        return;
      }
      resolve(response ? response.data : undefined);
    });
  });
}

export function reply(sendResponse, fn) {
  Promise.resolve()
    .then(fn)
    .then((data) => sendResponse({ ok: true, data }))
    .catch((err) => {
      console.error("[messages] handler error:", err);
      sendResponse({ ok: false, error: err && err.message ? err.message : String(err) });
    });
  return true; // keep channel open for async response
}
