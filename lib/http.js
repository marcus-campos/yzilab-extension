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
        const err = new Error(
          `HTTP ${response.status} ${response.statusText} — ${typeof data === "string" ? data.slice(0, 200) : JSON.stringify(data).slice(0, 200)}`
        );
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
