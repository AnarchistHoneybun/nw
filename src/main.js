import { createFileOperations } from "./editor/fileOperations.js";
import { normalizeEditorStructure } from "./editor/paragraphs.js";
import {
  readFocusLevelPreference,
  readFocusModePreference,
  readSyntaxPosPreference,
  writeFocusLevelPreference,
  writeFocusModePreference,
  readFontPreference,
  writeSyntaxPosPreference,
  writeFontPreference,
} from "./editor/preferences.js";
import {
  ensureValidCaret,
  getActiveParagraph,
  insertPlainTextAtSelection,
  splitParagraphAtSelection,
  setActiveParagraph,
} from "./editor/selection.js";

let currentFilePath = null;
let hasUnsavedChanges = false;

const FOCUS_LEVEL_PARAGRAPH = "paragraph";
const FOCUS_LEVEL_SENTENCE = "sentence";
const SYNTAX_POS_ORDER = ["noun", "verb", "adjective", "adverb", "conjunction"];

function updateUnsavedIndicator() {
  const fileNameElement = document.querySelector("#file-name");
  const filenameText = document.querySelector("#filename-text");

  if (!fileNameElement || !filenameText) {
    return;
  }

  if (hasUnsavedChanges) {
    fileNameElement.classList.add("has-unsaved");
  } else {
    fileNameElement.classList.remove("has-unsaved");
  }

  const displayName = currentFilePath
    ? currentFilePath.split(/[\\/]/).pop()
    : "untitled.txt";
  filenameText.textContent = displayName;
}

function markUnsavedChanges() {
  hasUnsavedChanges = true;
  updateUnsavedIndicator();
}

function clearUnsavedChanges() {
  hasUnsavedChanges = false;
  updateUnsavedIndicator();
}

function updateWordCount() {
  const wordCountElement = document.querySelector("#word-count");
  if (!wordCountElement) {
    return;
  }

  const editor = document.querySelector("#editor");
  if (!editor) {
    return;
  }

  const text = editor.textContent || "";
  const words = text
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0).length;

  const pluralSuffix = words === 1 ? "" : "s";
  wordCountElement.textContent = `${words} word${pluralSuffix}`;
}

const fileOperations = createFileOperations({
  getCurrentFilePath: () => currentFilePath,
  setCurrentFilePath: (path) => {
    currentFilePath = path;
  },
  getHasUnsavedChanges: () => hasUnsavedChanges,
  clearUnsavedChanges,
  updateUnsavedIndicator,
});

// Initialize editor when DOM is ready (defer ensures this runs after DOM parsing)
(function initialize() {
  const editor = document.querySelector("#editor");
  const editorContainer = document.querySelector(".editor-container");
  const focusToggleButton = document.querySelector("#focus-toggle-button");
  const focusMenuButton = document.querySelector("#focus-menu-button");
  const focusLevelMenu = document.querySelector("#focus-level-menu");
  const focusLevelOptions = Array.from(
    document.querySelectorAll(".focus-level-option"),
  );
  const focusControl = document.querySelector("#focus-control");
  const appShell = document.querySelector(".app-shell");

  if (
    !editor ||
    !editorContainer ||
    !focusToggleButton ||
    !focusMenuButton ||
    !focusLevelMenu ||
    !focusControl ||
    !appShell
  ) {
    return;
  }

  let focusModeEnabled = readFocusModePreference();
  let focusLevel = readFocusLevelPreference();
  let focusMenuOpen = false;
  let isComposing = false;
  let isApplyingSentenceFocus = false;
  let caretScrollFrame = null;
  let manualScrollLockUntil = 0;
  let syntaxRefreshToken = 0;
  let syntaxPosSettings = readSyntaxPosPreference();

  const syntaxParseCache = new Map();
  const nlpEngine = globalThis.nlp;

  const MANUAL_SCROLL_LOCK_MS = 450;

  function ensureCaretVisibleInEditor() {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return;
    }

    const range = selection.getRangeAt(0);
    if (!editor.contains(range.startContainer)) {
      return;
    }

    const editorRect = editor.getBoundingClientRect();
    const safeMargin = Math.max(28, Math.min(96, editor.clientHeight * 0.22));
    const upperBound = editorRect.top + safeMargin;
    const lowerBound = editorRect.bottom - safeMargin;

    const caretRange = range.cloneRange();
    caretRange.collapse(true);
    const caretRects = caretRange.getClientRects();
    const caretRect =
      caretRects.length > 0
        ? caretRects[0]
        : getActiveParagraph(editor)?.getBoundingClientRect();

    if (!caretRect) {
      return;
    }

    if (caretRect.top < upperBound) {
      editor.scrollTop -= upperBound - caretRect.top;
      return;
    }

    if (caretRect.bottom > lowerBound) {
      editor.scrollTop += caretRect.bottom - lowerBound;
    }
  }

  function shouldAutoFollowCaret() {
    if (Date.now() < manualScrollLockUntil) {
      return false;
    }

    return document.activeElement === editor;
  }

  function scheduleCaretVisibilityUpdate() {
    if (!shouldAutoFollowCaret()) {
      return;
    }

    if (caretScrollFrame !== null) {
      return;
    }

    caretScrollFrame = window.requestAnimationFrame(() => {
      caretScrollFrame = null;
      ensureCaretVisibleInEditor();
    });
  }

  function isCaretNavigationKey(event) {
    return [
      "ArrowUp",
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
      "Home",
      "End",
      "PageUp",
      "PageDown",
    ].includes(event.key);
  }

  function unwrapSentenceHighlights(paragraph) {
    if (!(paragraph instanceof HTMLElement)) {
      return;
    }

    const sentenceSpans = Array.from(
      paragraph.querySelectorAll(":scope > .focus-sentence-segment"),
    );

    sentenceSpans.forEach((span) => {
      const text = span.textContent || "";
      span.replaceWith(document.createTextNode(text));
    });

    paragraph.normalize();
  }

  function clearSentenceHighlights(exceptParagraph = null) {
    const paragraphs = Array.from(
      editor.querySelectorAll(":scope > .editor-paragraph"),
    );
    paragraphs.forEach((paragraph) => {
      if (exceptParagraph && paragraph === exceptParagraph) {
        return;
      }
      unwrapSentenceHighlights(paragraph);
    });
  }

  function getOffsetInElement(element, node, offset) {
    const range = document.createRange();
    range.selectNodeContents(element);
    range.setEnd(node, offset);
    return range.toString().length;
  }

  function saveSelectionOffsetsForParagraph(paragraph) {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return null;
    }

    const range = selection.getRangeAt(0);
    if (
      !paragraph.contains(range.startContainer) ||
      !paragraph.contains(range.endContainer)
    ) {
      return null;
    }

    return {
      start: getOffsetInElement(
        paragraph,
        range.startContainer,
        range.startOffset,
      ),
      end: getOffsetInElement(paragraph, range.endContainer, range.endOffset),
    };
  }

  function resolveTextPositionForOffset(paragraph, targetOffset) {
    const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
    let currentNode = walker.nextNode();
    let remaining = Math.max(0, targetOffset);
    let lastTextNode = null;

    while (currentNode) {
      lastTextNode = currentNode;
      const textLength = currentNode.textContent?.length ?? 0;
      if (remaining <= textLength) {
        return { node: currentNode, offset: remaining };
      }

      remaining -= textLength;
      currentNode = walker.nextNode();
    }

    if (lastTextNode) {
      return {
        node: lastTextNode,
        offset: lastTextNode.textContent?.length ?? 0,
      };
    }

    return { node: paragraph, offset: 0 };
  }

  function restoreSelectionOffsetsForParagraph(paragraph, offsets) {
    if (!offsets) {
      return;
    }

    const selection = window.getSelection();
    if (!selection) {
      return;
    }

    const start = resolveTextPositionForOffset(paragraph, offsets.start);
    const end = resolveTextPositionForOffset(paragraph, offsets.end);

    const nextRange = document.createRange();
    nextRange.setStart(start.node, start.offset);
    nextRange.setEnd(end.node, end.offset);
    selection.removeAllRanges();
    selection.addRange(nextRange);
  }

  function getSyntaxSettingsKey() {
    return SYNTAX_POS_ORDER.map(
      (key) => `${key}:${syntaxPosSettings[key] ? 1 : 0}`,
    ).join("|");
  }

  function clearSyntaxCache() {
    syntaxParseCache.clear();
  }

  function classifyPosTag(tags) {
    if (tags.includes("Adjective")) {
      return "adjective";
    }
    if (tags.includes("Adverb")) {
      return "adverb";
    }
    if (tags.includes("Conjunction")) {
      return "conjunction";
    }
    if (tags.includes("Verb")) {
      return "verb";
    }
    if (tags.includes("Noun")) {
      return "noun";
    }
    return null;
  }

  function getSyntaxRangesForText(text) {
    if (!text) {
      return [];
    }

    if (typeof nlpEngine !== "function") {
      return [];
    }

    const settingsKey = getSyntaxSettingsKey();
    const cacheKey = `${settingsKey}::${text}`;
    if (syntaxParseCache.has(cacheKey)) {
      return syntaxParseCache.get(cacheKey);
    }

    const terms = nlpEngine(text).terms().json();
    const ranges = [];
    let cursor = 0;

    terms.forEach((item) => {
      const term = item?.terms?.[0];
      const tokenText = term?.text;
      if (!tokenText) {
        return;
      }

      const tags = Array.isArray(term.tags) ? term.tags : [];
      const posClass = classifyPosTag(tags);
      const start = text.indexOf(tokenText, cursor);
      if (start < 0) {
        return;
      }

      const end = start + tokenText.length;
      cursor = end + (term.post?.length ?? 0);

      if (!posClass || !syntaxPosSettings[posClass]) {
        return;
      }

      ranges.push({ start, end, posClass });
    });

    if (syntaxParseCache.size > 4000) {
      syntaxParseCache.clear();
    }

    syntaxParseCache.set(cacheKey, ranges);
    return ranges;
  }

  function buildSyntaxFragment(text, ranges) {
    const fragment = document.createDocumentFragment();
    let cursor = 0;

    ranges.forEach((range) => {
      if (range.start > cursor) {
        fragment.appendChild(
          document.createTextNode(text.slice(cursor, range.start)),
        );
      }

      const span = document.createElement("span");
      span.classList.add("syntax-token", `syntax-${range.posClass}`);
      span.textContent = text.slice(range.start, range.end);
      fragment.appendChild(span);

      cursor = range.end;
    });

    if (cursor < text.length) {
      fragment.appendChild(document.createTextNode(text.slice(cursor)));
    }

    return fragment;
  }

  function clearSyntaxHighlightsInElement(element) {
    if (!(element instanceof HTMLElement)) {
      return;
    }

    const highlightedTokens = Array.from(
      element.querySelectorAll(".syntax-token"),
    );
    highlightedTokens.forEach((token) => {
      token.replaceWith(document.createTextNode(token.textContent || ""));
    });

    element.normalize();
  }

  function clearSyntaxHighlights(exceptParagraph = null) {
    const paragraphs = Array.from(
      editor.querySelectorAll(":scope > .editor-paragraph"),
    );

    paragraphs.forEach((paragraph) => {
      if (exceptParagraph && paragraph === exceptParagraph) {
        return;
      }

      clearSyntaxHighlightsInElement(paragraph);
    });
  }

  function getSyntaxContainers(paragraph) {
    if (!(paragraph instanceof HTMLElement)) {
      return [];
    }

    if (focusModeEnabled && focusLevel === FOCUS_LEVEL_SENTENCE) {
      const segments = Array.from(
        paragraph.querySelectorAll(":scope > .focus-sentence-segment"),
      );
      if (segments.length > 0) {
        return segments;
      }
    }

    return [paragraph];
  }

  function applySyntaxHighlightsToParagraph(paragraph, options = {}) {
    const { preserveSelection = false } = options;

    if (!(paragraph instanceof HTMLElement)) {
      return;
    }

    const selectionOffsets = preserveSelection
      ? saveSelectionOffsetsForParagraph(paragraph)
      : null;

    const containers = getSyntaxContainers(paragraph);
    containers.forEach((container) => {
      clearSyntaxHighlightsInElement(container);

      const text = container.textContent || "";
      if (!text.trim()) {
        return;
      }

      const ranges = getSyntaxRangesForText(text);
      if (ranges.length === 0) {
        return;
      }

      container.textContent = "";
      container.appendChild(buildSyntaxFragment(text, ranges));
    });

    if (preserveSelection && selectionOffsets) {
      restoreSelectionOffsetsForParagraph(paragraph, selectionOffsets);
    }
  }

  function scheduleSyntaxHighlightForAllParagraphs() {
    if (!focusModeEnabled) {
      return;
    }

    syntaxRefreshToken += 1;
    const currentToken = syntaxRefreshToken;
    const paragraphs = Array.from(
      editor.querySelectorAll(":scope > .editor-paragraph"),
    );
    const activeParagraph = getActiveParagraph(editor);

    let index = 0;
    const processChunk = () => {
      if (!focusModeEnabled || currentToken !== syntaxRefreshToken) {
        return;
      }

      const chunkStart = performance.now();
      while (index < paragraphs.length && performance.now() - chunkStart < 8) {
        const paragraph = paragraphs[index];
        index += 1;
        if (paragraph === activeParagraph) {
          continue;
        }
        applySyntaxHighlightsToParagraph(paragraph, {
          preserveSelection: false,
        });
      }

      if (index < paragraphs.length) {
        window.requestAnimationFrame(processChunk);
      }
    };

    window.requestAnimationFrame(processChunk);
  }

  function findSentenceBounds(text, caretOffset) {
    if (!text) {
      return { start: 0, end: 0 };
    }

    const splitPoints = [0];
    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];
      const isSentenceEndChar = char === "." || char === "!" || char === "?";
      if (!isSentenceEndChar) {
        continue;
      }

      const nextChar = text[index + 1];
      const isBoundary = !nextChar || /\s/.test(nextChar);
      if (isBoundary) {
        splitPoints.push(index + 1);
      }
    }

    if (splitPoints[splitPoints.length - 1] !== text.length) {
      splitPoints.push(text.length);
    }

    const safeCaret = Math.max(0, Math.min(caretOffset, text.length));
    for (let i = 0; i < splitPoints.length - 1; i += 1) {
      const start = splitPoints[i];
      const end = splitPoints[i + 1];
      if (safeCaret <= end) {
        return { start, end };
      }
    }

    return {
      start: splitPoints[splitPoints.length - 2] ?? 0,
      end: splitPoints[splitPoints.length - 1] ?? text.length,
    };
  }

  function applySentenceFocusToParagraph(paragraph) {
    if (!(paragraph instanceof HTMLElement)) {
      return;
    }

    isApplyingSentenceFocus = true;

    try {
      const selectionOffsets = saveSelectionOffsetsForParagraph(paragraph);
      const paragraphText = paragraph.textContent || "";
      const caretOffset = selectionOffsets
        ? selectionOffsets.start
        : paragraphText.length;
      const bounds = findSentenceBounds(paragraphText, caretOffset);

      paragraph.textContent = "";

      const leading = paragraphText.slice(0, bounds.start);
      const active = paragraphText.slice(bounds.start, bounds.end);
      const trailing = paragraphText.slice(bounds.end);

      if (leading) {
        const leadingSpan = document.createElement("span");
        leadingSpan.classList.add("focus-sentence-segment");
        leadingSpan.textContent = leading;
        paragraph.appendChild(leadingSpan);
      }

      if (active) {
        const activeSpan = document.createElement("span");
        activeSpan.classList.add(
          "focus-sentence-segment",
          "is-active-sentence",
        );
        activeSpan.textContent = active;
        paragraph.appendChild(activeSpan);
      }

      if (trailing) {
        const trailingSpan = document.createElement("span");
        trailingSpan.classList.add("focus-sentence-segment");
        trailingSpan.textContent = trailing;
        paragraph.appendChild(trailingSpan);
      }

      if (!leading && !active && !trailing) {
        paragraph.appendChild(document.createElement("br"));
      }

      restoreSelectionOffsetsForParagraph(paragraph, selectionOffsets);
    } finally {
      isApplyingSentenceFocus = false;
    }
  }

  function updateFocusControlState() {
    focusToggleButton.classList.toggle("is-enabled", focusModeEnabled);
    focusToggleButton.setAttribute("aria-pressed", String(focusModeEnabled));

    focusLevelOptions.forEach((option) => {
      const level = option.dataset.focusLevel;
      const isSelected = level === focusLevel;
      option.classList.toggle("is-selected", isSelected);
      option.setAttribute("aria-checked", String(isSelected));
    });
  }

  function closeFocusMenu() {
    focusMenuOpen = false;
    focusLevelMenu.hidden = true;
    focusMenuButton.setAttribute("aria-expanded", "false");
  }

  function openFocusMenu() {
    focusMenuOpen = true;
    focusLevelMenu.hidden = false;
    focusMenuButton.setAttribute("aria-expanded", "true");
  }

  function setFocusLevel(level, options = {}) {
    const { followCaret = false } = options;

    const normalizedLevel =
      level === FOCUS_LEVEL_SENTENCE
        ? FOCUS_LEVEL_SENTENCE
        : FOCUS_LEVEL_PARAGRAPH;

    focusLevel = normalizedLevel;
    writeFocusLevelPreference(normalizedLevel);
    editorContainer.classList.toggle(
      "focus-level-sentence",
      focusLevel === FOCUS_LEVEL_SENTENCE,
    );
    updateFocusControlState();
    updateFocusParagraph({ followCaret });
  }

  function updateFocusParagraph(options = {}) {
    const { followCaret = false } = options;

    normalizeEditorStructure(editor);
    ensureValidCaret(editor);

    if (!focusModeEnabled) {
      clearSentenceHighlights();
      clearSyntaxHighlights();
      if (followCaret) {
        scheduleCaretVisibilityUpdate();
      }
      return;
    }

    const activeParagraph = getActiveParagraph(editor);
    if (activeParagraph) {
      setActiveParagraph(editor, activeParagraph);
      if (focusLevel === FOCUS_LEVEL_SENTENCE && !isComposing) {
        clearSentenceHighlights(activeParagraph);
        applySentenceFocusToParagraph(activeParagraph);
      } else {
        clearSentenceHighlights();
      }

      applySyntaxHighlightsToParagraph(activeParagraph, {
        preserveSelection: true,
      });

      if (followCaret) {
        scheduleCaretVisibilityUpdate();
      }
      return;
    }

    const firstParagraph = editor.querySelector(":scope > .editor-paragraph");
    setActiveParagraph(editor, firstParagraph);

    if (firstParagraph && focusLevel === FOCUS_LEVEL_SENTENCE && !isComposing) {
      clearSentenceHighlights(firstParagraph);
      applySentenceFocusToParagraph(firstParagraph);
    } else {
      clearSentenceHighlights();
    }

    if (firstParagraph) {
      applySyntaxHighlightsToParagraph(firstParagraph, {
        preserveSelection: true,
      });
    }

    if (followCaret) {
      scheduleCaretVisibilityUpdate();
    }
  }

  function applyFocusMode(enabled) {
    focusModeEnabled = enabled;
    editorContainer.classList.toggle("focus-mode", enabled);
    appShell.classList.toggle("focus-mode-fullscreen", enabled);
    writeFocusModePreference(enabled);
    updateFocusControlState();

    if (enabled) {
      updateFocusParagraph({ followCaret: true });
      scheduleSyntaxHighlightForAllParagraphs();
    } else {
      setActiveParagraph(editor, null);
      clearSentenceHighlights();
      clearSyntaxHighlights();
      closeFocusMenu();
    }
  }

  focusToggleButton.addEventListener("click", () => {
    applyFocusMode(!focusModeEnabled);
    editor.focus();
  });

  focusMenuButton.addEventListener("click", () => {
    if (focusMenuOpen) {
      closeFocusMenu();
    } else {
      openFocusMenu();
    }
  });

  focusLevelOptions.forEach((option) => {
    option.addEventListener("click", () => {
      const level = option.dataset.focusLevel;
      setFocusLevel(level, { followCaret: true });
      closeFocusMenu();
      editor.focus();
    });
  });

  editor.addEventListener(
    "wheel",
    () => {
      manualScrollLockUntil = Date.now() + MANUAL_SCROLL_LOCK_MS;
    },
    { passive: true },
  );

  document.addEventListener("click", (event) => {
    if (!focusMenuOpen) {
      return;
    }

    const target = event.target;
    if (!(target instanceof Node)) {
      return;
    }

    if (!focusControl.contains(target)) {
      closeFocusMenu();
    }
  });

  editor.addEventListener("input", () => {
    markUnsavedChanges();
    updateFocusParagraph({ followCaret: true });
    updateWordCount();
  });

  editor.addEventListener("paste", (event) => {
    event.preventDefault();

    const pastedText = event.clipboardData?.getData("text/plain") || "";
    const normalizedText = pastedText.replace(/\r\n?/g, "\n");
    if (!normalizedText) {
      return;
    }

    insertPlainTextAtSelection(editor, normalizedText);
    markUnsavedChanges();
    updateFocusParagraph({ followCaret: true });
    updateWordCount();
  });

  editor.addEventListener("keydown", async (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      splitParagraphAtSelection(editor);
      markUnsavedChanges();
      updateFocusParagraph({ followCaret: true });
      return;
    }

    if (event.ctrlKey || event.metaKey) {
      if (event.key === "s" || event.key === "S") {
        event.preventDefault();
        if (event.shiftKey) {
          await fileOperations.saveFileAs();
        } else {
          await fileOperations.saveCurrentFile();
        }
        return;
      }
      if (event.key === "o" || event.key === "O") {
        event.preventDefault();
        await fileOperations.openFile();
        return;
      }
      if (event.key === "n" || event.key === "N") {
        event.preventDefault();
        await fileOperations.newFile();
        return;
      }
    }

    if (event.key === "Backspace" || event.key === "Delete") {
      window.requestAnimationFrame(() =>
        updateFocusParagraph({ followCaret: true }),
      );
      return;
    }

    if (isCaretNavigationKey(event)) {
      window.requestAnimationFrame(() =>
        updateFocusParagraph({ followCaret: true }),
      );
    }
  });

  editor.addEventListener("compositionstart", () => {
    isComposing = true;
  });

  editor.addEventListener("compositionend", () => {
    isComposing = false;
    updateFocusParagraph({ followCaret: true });
  });

  document.addEventListener("keydown", (event) => {
    const isFocusShortcut =
      (event.ctrlKey || event.metaKey) &&
      event.shiftKey &&
      !event.altKey &&
      event.code === "KeyF";

    if (!isFocusShortcut) {
      return;
    }

    event.preventDefault();
    applyFocusMode(!focusModeEnabled);
    closeFocusMenu();
    editor.focus();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && focusMenuOpen) {
      closeFocusMenu();
      editor.focus();
    }
  });

  editor.addEventListener("keyup", () =>
    updateFocusParagraph({ followCaret: false }),
  );
  editor.addEventListener("click", () =>
    updateFocusParagraph({ followCaret: true }),
  );
  editor.addEventListener("focus", () =>
    updateFocusParagraph({ followCaret: true }),
  );

  document.addEventListener("selectionchange", () => {
    if (isApplyingSentenceFocus) {
      return;
    }

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return;
    }
    if (!editor.contains(selection.anchorNode)) {
      return;
    }
    updateFocusParagraph({ followCaret: false });
  });

  // Menu handling
  const menuButton = document.querySelector("#menu-button");
  const menuScreen = document.querySelector("#menu-screen");
  const menuCloseButton = document.querySelector("#menu-close-button");
  const fontOptions = Array.from(document.querySelectorAll(".font-option"));
  const syntaxPosOptions = Array.from(
    document.querySelectorAll(".syntax-pos-option"),
  );
  const menuIconTabs = Array.from(document.querySelectorAll(".menu-icon-tab"));
  const menuSections = Array.from(document.querySelectorAll(".menu-section"));

  if (
    menuButton &&
    menuScreen &&
    menuCloseButton &&
    fontOptions.length > 0 &&
    syntaxPosOptions.length > 0 &&
    menuIconTabs.length > 0 &&
    menuSections.length > 0
  ) {
    let menuOpen = false;
    let currentFont = readFontPreference();

    function applyFont(font) {
      currentFont = font;
      writeFontPreference(font);

      if (font === "plex-serif") {
        editor.style.fontFamily = '"IBMPlexSerif", serif';
      } else {
        editor.style.fontFamily =
          '"InterVariable", "Inter", "Segoe UI", Roboto, -apple-system, BlinkMacSystemFont, sans-serif';
      }

      // Update active button
      fontOptions.forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.font === font);
      });
    }

    function updateSyntaxOptionsUI() {
      syntaxPosOptions.forEach((button) => {
        const pos = button.dataset.pos;
        const isEnabled = Boolean(pos && syntaxPosSettings[pos]);
        button.classList.toggle("is-enabled", isEnabled);
        button.setAttribute("aria-pressed", String(isEnabled));
      });
    }

    function switchMenuTab(tabName) {
      menuIconTabs.forEach((tab) => {
        const isActive = tab.dataset.tab === tabName;
        tab.classList.toggle("active", isActive);
      });

      menuSections.forEach((section) => {
        const isActive = section.dataset.tab === tabName;
        section.classList.toggle("active", isActive);
      });
    }

    function openMenu() {
      menuOpen = true;
      menuScreen.hidden = false;
      menuButton.setAttribute("aria-expanded", "true");
    }

    function closeMenu() {
      menuOpen = false;
      menuScreen.hidden = true;
      menuButton.setAttribute("aria-expanded", "false");
      editor.focus();
    }

    menuButton.addEventListener("click", () => {
      if (menuOpen) {
        closeMenu();
      } else {
        openMenu();
      }
    });

    menuCloseButton.addEventListener("click", () => {
      closeMenu();
    });

    menuIconTabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        const tabName = tab.dataset.tab;
        if (tabName) {
          switchMenuTab(tabName);
        }
      });
    });

    fontOptions.forEach((btn) => {
      btn.addEventListener("click", () => {
        const font = btn.dataset.font;
        if (font) {
          applyFont(font);
        }
      });
    });

    syntaxPosOptions.forEach((button) => {
      button.addEventListener("click", () => {
        const pos = button.dataset.pos;
        if (
          !pos ||
          !Object.prototype.hasOwnProperty.call(syntaxPosSettings, pos)
        ) {
          return;
        }

        syntaxPosSettings = {
          ...syntaxPosSettings,
          [pos]: !syntaxPosSettings[pos],
        };

        writeSyntaxPosPreference(syntaxPosSettings);
        updateSyntaxOptionsUI();
        clearSyntaxCache();

        if (focusModeEnabled) {
          updateFocusParagraph({ followCaret: false });
          scheduleSyntaxHighlightForAllParagraphs();
        }
      });
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && menuOpen) {
        closeMenu();
      }
    });

    // Initialize menu state
    switchMenuTab("typography");
    updateSyntaxOptionsUI();
    applyFont(currentFont);
    closeMenu();
  }

  normalizeEditorStructure(editor);
  updateUnsavedIndicator();
  updateWordCount();

  setFocusLevel(focusLevel);
  closeFocusMenu();

  applyFocusMode(focusModeEnabled);
  editor.focus();
})();
