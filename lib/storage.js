// Wrapper sobre chrome.storage.local e chrome.storage.session.

export const local = {
  async get(key) {
    const obj = await chrome.storage.local.get(key);
    return obj[key];
  },
  async set(key, value) {
    return chrome.storage.local.set({ [key]: value });
  },
  async remove(key) {
    return chrome.storage.local.remove(key);
  },
  async clear() {
    return chrome.storage.local.clear();
  },
};

export const session = {
  async get(key) {
    const obj = await chrome.storage.session.get(key);
    return obj[key];
  },
  async set(key, value) {
    return chrome.storage.session.set({ [key]: value });
  },
  async remove(key) {
    return chrome.storage.session.remove(key);
  },
};

export const KEYS = {
  YZILAB_TOKEN: "yzilab_token",
  YZILAB_USER: "yzilab_user",
  SETTINGS: "settings",
  PETLOVE_SESSION: "petlove_session",
  HEALTH_INSURANCE_PETLOVE: "health_insurance_petlove",
  LOG_BUFFER: "log_buffer",
};

export const DEFAULT_SETTINGS = {
  yzilabBaseUrl: "https://api-df.animalex.com.br",
  yzilabApiPath: "/api/v1",
  autoSyncEnabled: false,
  autoSyncIntervalMinutes: 15,
};

export async function getSettings() {
  const stored = (await local.get(KEYS.SETTINGS)) || {};
  return { ...DEFAULT_SETTINGS, ...stored };
}

export async function setSettings(partial) {
  const current = await getSettings();
  const merged = { ...current, ...partial };
  await local.set(KEYS.SETTINGS, merged);
  return merged;
}
