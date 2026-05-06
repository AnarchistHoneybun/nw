const FOCUS_MODE_STORAGE_KEY = "nw.focusMode";
const FOCUS_LEVEL_STORAGE_KEY = "nw.focusLevel";
const FONT_STORAGE_KEY = "nw.font";
const SYNTAX_POS_STORAGE_KEY = "nw.syntaxPos";

const DEFAULT_FOCUS_LEVEL = "paragraph";
const FOCUS_LEVEL_VALUES = new Set(["paragraph", "sentence"]);
const DEFAULT_FONT = "inter";
const FONT_VALUES = new Set(["inter", "plex-serif"]);
const DEFAULT_SYNTAX_POS = {
  noun: true,
  verb: true,
  adjective: true,
  adverb: true,
  conjunction: true,
};

const SYNTAX_POS_KEYS = Object.keys(DEFAULT_SYNTAX_POS);

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

export function readFontPreference() {
  const value = localStorage.getItem(FONT_STORAGE_KEY);
  if (!value || !FONT_VALUES.has(value)) {
    return DEFAULT_FONT;
  }
  return value;
}

export function writeFontPreference(font) {
  const normalizedFont = FONT_VALUES.has(font) ? font : DEFAULT_FONT;
  localStorage.setItem(FONT_STORAGE_KEY, normalizedFont);
}

export function readSyntaxPosPreference() {
  const value = localStorage.getItem(SYNTAX_POS_STORAGE_KEY);
  if (!value) {
    return { ...DEFAULT_SYNTAX_POS };
  }

  try {
    const parsed = JSON.parse(value);
    const nextValue = {};

    SYNTAX_POS_KEYS.forEach((key) => {
      nextValue[key] =
        typeof parsed?.[key] === "boolean"
          ? parsed[key]
          : DEFAULT_SYNTAX_POS[key];
    });

    return nextValue;
  } catch {
    return { ...DEFAULT_SYNTAX_POS };
  }
}

export function writeSyntaxPosPreference(posMap) {
  const normalizedValue = {};

  SYNTAX_POS_KEYS.forEach((key) => {
    normalizedValue[key] =
      typeof posMap?.[key] === "boolean"
        ? posMap[key]
        : DEFAULT_SYNTAX_POS[key];
  });

  localStorage.setItem(SYNTAX_POS_STORAGE_KEY, JSON.stringify(normalizedValue));
}
