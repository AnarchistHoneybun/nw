import { createFileOperations } from "./editor/fileOperations.js";
import { normalizeEditorStructure } from "./editor/paragraphs.js";
import {
  readFocusLevelPreference,
  readFocusModePreference,
  writeFocusLevelPreference,
  writeFocusModePreference,
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

const fileOperations = createFileOperations({
  getCurrentFilePath: () => currentFilePath,
  setCurrentFilePath: (path) => {
    currentFilePath = path;
  },
  getHasUnsavedChanges: () => hasUnsavedChanges,
  clearUnsavedChanges,
  updateUnsavedIndicator,
});

window.addEventListener("DOMContentLoaded", () => {
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

  function setFocusLevel(level) {
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
    updateFocusParagraph();
  }

  function updateFocusParagraph() {
    normalizeEditorStructure(editor);
    ensureValidCaret(editor);

    if (!focusModeEnabled) {
      clearSentenceHighlights();
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
  }

  function applyFocusMode(enabled) {
    focusModeEnabled = enabled;
    editorContainer.classList.toggle("focus-mode", enabled);
    appShell.classList.toggle("focus-mode-fullscreen", enabled);
    writeFocusModePreference(enabled);
    updateFocusControlState();

    if (enabled) {
      updateFocusParagraph();
    } else {
      setActiveParagraph(editor, null);
      clearSentenceHighlights();
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
      setFocusLevel(level);
      closeFocusMenu();
      editor.focus();
    });
  });

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
    updateFocusParagraph();
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
    updateFocusParagraph();
  });

  editor.addEventListener("keydown", async (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      splitParagraphAtSelection(editor);
      markUnsavedChanges();
      updateFocusParagraph();
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
      window.requestAnimationFrame(() => updateFocusParagraph());
    }
  });

  editor.addEventListener("compositionstart", () => {
    isComposing = true;
  });

  editor.addEventListener("compositionend", () => {
    isComposing = false;
    updateFocusParagraph();
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

  editor.addEventListener("keyup", () => updateFocusParagraph());
  editor.addEventListener("click", () => updateFocusParagraph());
  editor.addEventListener("focus", () => updateFocusParagraph());

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
    updateFocusParagraph();
  });

  normalizeEditorStructure(editor);
  updateUnsavedIndicator();

  setFocusLevel(focusLevel);
  closeFocusMenu();

  applyFocusMode(focusModeEnabled);
  editor.focus();
});
