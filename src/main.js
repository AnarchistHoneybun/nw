import { createFileOperations } from "./editor/fileOperations.js";
import { normalizeEditorStructure } from "./editor/paragraphs.js";
import {
  readFocusModePreference,
  writeFocusModePreference,
} from "./editor/preferences.js";
import {
  ensureValidCaret,
  getActiveParagraph,
  insertPlainTextAtSelection,
  setActiveParagraph,
} from "./editor/selection.js";

let currentFilePath = null;
let hasUnsavedChanges = false;

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
  const focusModeToggle = document.querySelector("#focus-mode-toggle");

  if (!editor || !editorContainer || !focusModeToggle) {
    return;
  }

  let focusModeEnabled = readFocusModePreference();

  function updateFocusParagraph() {
    normalizeEditorStructure(editor);
    ensureValidCaret(editor);

    if (!focusModeEnabled) {
      return;
    }

    const activeParagraph = getActiveParagraph(editor);
    if (activeParagraph) {
      setActiveParagraph(editor, activeParagraph);
      return;
    }

    const firstParagraph = editor.querySelector(":scope > .editor-paragraph");
    setActiveParagraph(editor, firstParagraph);
  }

  function applyFocusMode(enabled) {
    focusModeEnabled = enabled;
    focusModeToggle.checked = enabled;
    editorContainer.classList.toggle("focus-mode", enabled);
    writeFocusModePreference(enabled);

    if (enabled) {
      updateFocusParagraph();
    } else {
      setActiveParagraph(editor, null);
    }
  }

  focusModeToggle.addEventListener("change", (event) => {
    applyFocusMode(event.currentTarget.checked);
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

  editor.addEventListener("keyup", () => updateFocusParagraph());
  editor.addEventListener("click", () => updateFocusParagraph());
  editor.addEventListener("focus", () => updateFocusParagraph());

  document.addEventListener("selectionchange", () => {
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

  applyFocusMode(focusModeEnabled);
  editor.focus();
});
