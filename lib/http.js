// Wrapper fetch com retry simples e parsing JSON. Não inclui auth — quem chama injeta.

export async function request(url, options = {}) {
  const {
    method = "GET",
    headers = {},
    body,
    timeoutMs = 30000,
    retries = 1,
    credentials = "omit",
    asFormData = false,
  } = options;

  const finalHeaders = { Accept: "application/json", ...headers };
  let fetchBody;
  if (asFormData) {
    fetchBody = body; // FormData; não setar Content-Type
  } else if (body !== undefined && body !== null && typeof body !== "string") {
    finalHeaders["Content-Type"] = "application/json";
    fetchBody = JSON.stringify(body);
  } else {
    fetchBody = body;
  }

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method,
        headers: finalHeaders,
        body: fetchBody,
        credentials,
        signal: controller.signal,
      });
      clearTimeout(timer);

      const contentType = response.headers.get("content-type") || "";
      let data;
      if (contentType.includes("application/json")) {
        data = await response.json().catch(() => ({}));
      } else {
        data = await response.text();
      }

      if (!response.ok) {
        const friendly = extractFriendlyMessage(data, response);
        const err = new Error(friendly);
        err.status = response.status;
        err.data = data;
        if (response.status >= 500 && attempt < retries) {
          lastErr = err;
          continue;
        }
        throw err;
      }

      return { status: response.status, data, headers: response.headers };
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      if (attempt >= retries) throw err;
    }
  }
  throw lastErr;
}

// Extrai a melhor mensagem possível do corpo de erro de uma response HTTP.
// Prioridade: data.detail > data.error > join de campos com array de strings > JSON cru curto.
// Limpa o prefixo "Failed to ..." e tags `ErrorDetail(...)` do DRF.
function extractFriendlyMessage(data, response) {
  if (typeof data === "string") {
    const trimmed = data.trim();
    return trimmed ? cleanMessage(trimmed) : `${response.status} ${response.statusText}`;
  }
  if (data && typeof data === "object") {
    if (typeof data.detail === "string") return cleanMessage(data.detail);
    if (typeof data.error === "string") return cleanMessage(data.error);
    if (typeof data.message === "string") return cleanMessage(data.message);
    // erros de validação DRF tipo {"campo": ["msg1", "msg2"]}
    const fieldMessages = [];
    for (const [key, value] of Object.entries(data)) {
      if (Array.isArray(value) && value.every((v) => typeof v === "string")) {
        fieldMessages.push(`${key}: ${value.join(", ")}`);
      } else if (typeof value === "string") {
        fieldMessages.push(`${key}: ${value}`);
      }
    }
    if (fieldMessages.length) return cleanMessage(fieldMessages.join(" · "));
  }
  return `${response.status} ${response.statusText}`;
}

function cleanMessage(s) {
  if (!s) return "";
  let out = String(s).trim();
  // Tira prefixos genéricos do backend tipo "Failed to process exam request: ..."
  out = out.replace(/^Failed to [^:]+:\s*/i, "");
  // Tira a representação de DRF ErrorDetail: [ErrorDetail(string='msg', code='...')]
  // Captura tudo entre string=' ... ' e ignora o resto.
  const drfMatch = out.match(/string=['"]([^'"]+)['"]/);
  if (drfMatch) return drfMatch[1];
  // Tira colchetes externos restantes
  out = out.replace(/^\[+/, "").replace(/\]+$/, "");
  return out.trim();
}
