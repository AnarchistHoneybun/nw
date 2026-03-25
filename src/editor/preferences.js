const FOCUS_MODE_STORAGE_KEY = "nw.focusMode";

export function readFocusModePreference() {
  return localStorage.getItem(FOCUS_MODE_STORAGE_KEY) === "true";
}

export function writeFocusModePreference(enabled) {
  localStorage.setItem(FOCUS_MODE_STORAGE_KEY, String(enabled));
}
