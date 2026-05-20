// Logger: console + buffer circular em chrome.storage.local para o Settings.
import { local, KEYS } from "./storage.js";

const MAX_ENTRIES = 200;

async function append(level, args) {
  const message = args
    .map((a) => {
      if (a instanceof Error) return a.stack || a.message;
      if (typeof a === "object") {
        try {
          return JSON.stringify(a);
        } catch {
          return String(a);
        }
      }
      return String(a);
    })
    .join(" ");
  const entry = { ts: new Date().toISOString(), level, message };

  const buffer = (await local.get(KEYS.LOG_BUFFER)) || [];
  buffer.push(entry);
  if (buffer.length > MAX_ENTRIES) buffer.splice(0, buffer.length - MAX_ENTRIES);
  await local.set(KEYS.LOG_BUFFER, buffer);
}

export const log = {
  info(...args) {
    console.log("[yzilab]", ...args);
    append("info", args);
  },
  warn(...args) {
    console.warn("[yzilab]", ...args);
    append("warn", args);
  },
  error(...args) {
    console.error("[yzilab]", ...args);
    append("error", args);
  },
  async tail(n = 50) {
    const buf = (await local.get(KEYS.LOG_BUFFER)) || [];
    return buf.slice(-n);
  },
  async clear() {
    await local.set(KEYS.LOG_BUFFER, []);
  },
};
