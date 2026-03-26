const FOCUS_MODE_STORAGE_KEY = "nw.focusMode";
const FOCUS_LEVEL_STORAGE_KEY = "nw.focusLevel";

const DEFAULT_FOCUS_LEVEL = "paragraph";
const FOCUS_LEVEL_VALUES = new Set(["paragraph", "sentence"]);

export function readFocusModePreference() {
  return localStorage.getItem(FOCUS_MODE_STORAGE_KEY) === "true";
}

export function writeFocusModePreference(enabled) {
  localStorage.setItem(FOCUS_MODE_STORAGE_KEY, String(enabled));
}

export function readFocusLevelPreference() {
  const value = localStorage.getItem(FOCUS_LEVEL_STORAGE_KEY);
  if (!value || !FOCUS_LEVEL_VALUES.has(value)) {
    return DEFAULT_FOCUS_LEVEL;
  }
  return value;
}

export function writeFocusLevelPreference(level) {
  const normalizedLevel = FOCUS_LEVEL_VALUES.has(level)
    ? level
    : DEFAULT_FOCUS_LEVEL;
  localStorage.setItem(FOCUS_LEVEL_STORAGE_KEY, normalizedLevel);
}
