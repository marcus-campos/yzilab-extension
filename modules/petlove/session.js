// Content script em www.petlove.com.br.
// Lê access_token (localStorage) e XSRF-TOKEN (cookie) e envia ao service worker.
// IMPORTANTE: a chave de localStorage usada pela Petlove pode variar. Inspecionar a aba
// Application > Local Storage de www.petlove.com.br após login e ajustar TOKEN_KEYS abaixo.

(function () {
  const TOKEN_KEYS = ["access_token", "accessToken", "auth_token", "token"];
  const USER_KEYS = ["user_id", "userId", "user"];

  function readAccessToken() {
    for (const k of TOKEN_KEYS) {
      try {
        const v = localStorage.getItem(k);
        if (v && v.length > 16 && !v.startsWith("{")) return v;
        // alguns apps gravam JSON envolvendo o token
        if (v && v.startsWith("{")) {
          try {
            const obj = JSON.parse(v);
            const candidate = obj.access_token || obj.accessToken || obj.token;
            if (candidate && typeof candidate === "string") return candidate;
          } catch {
            /* ignore */
          }
        }
      } catch {
        /* ignore */
      }
    }
    return null;
  }

  function readUserId() {
    for (const k of USER_KEYS) {
      try {
        const v = localStorage.getItem(k);
        if (!v) continue;
        const n = Number(v);
        if (Number.isFinite(n) && n > 0) return n;
        try {
          const obj = JSON.parse(v);
          if (obj && (obj.id || obj.user_id)) return Number(obj.id || obj.user_id);
        } catch {
          /* ignore */
        }
      } catch {
        /* ignore */
      }
    }
    return null;
  }

  function readXsrfToken() {
    const cookies = document.cookie ? document.cookie.split(";") : [];
    for (const raw of cookies) {
      const [name, ...rest] = raw.trim().split("=");
      if (name === "XSRF-TOKEN") {
        try {
          return decodeURIComponent(rest.join("="));
        } catch {
          return rest.join("=");
        }
      }
    }
    return null;
  }

  function capture(reason) {
    const access_token = readAccessToken();
    const xsrf_token = readXsrfToken();
    if (!access_token && !xsrf_token) return;
    chrome.runtime.sendMessage(
      {
        type: "PETLOVE_SESSION_CAPTURED",
        payload: {
          access_token,
          xsrf_token,
          user_id: readUserId(),
          captured_at: Date.now(),
          reason,
        },
      },
      () => {
        if (chrome.runtime.lastError) {
          // service worker pode estar dormindo; ignorar silenciosamente
        }
      }
    );
  }

  capture("initial");
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") capture("visibility");
  });
  window.addEventListener("focus", () => capture("focus"));
  // re-captura periódica leve para refrescar XSRF caso a Petlove rotacione
  setInterval(() => capture("interval"), 5 * 60 * 1000);
})();
