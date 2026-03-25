import {
  createEmptyParagraph,
  createParagraphFromText,
  getEditorContent,
  normalizeEditorStructure,
} from "./paragraphs.js";
import { moveCaretToParagraphStart } from "./selection.js";

export function createFileOperations({
  getCurrentFilePath,
  setCurrentFilePath,
  getHasUnsavedChanges,
  clearUnsavedChanges,
  updateUnsavedIndicator,
}) {
  async function promptUnsavedChanges(action) {
    if (!getHasUnsavedChanges()) {
      return true;
    }

    const currentFilePath = getCurrentFilePath();
    const filename = currentFilePath
      ? currentFilePath.split(/[\\/]/).pop()
      : "untitled.txt";

    const value = confirm(`Save "${filename}" before ${action}?`);
    if (!value) {
      return false;
    }

    try {
      if (currentFilePath) {
        await saveCurrentFile();
      } else {
        await saveFileAs();
      }
      return true;
    } catch {
      alert("Could not save file. Cancelled operation.");
      return false;
    }
  }

  async function saveCurrentFile() {
    const editor = document.querySelector("#editor");
    if (!editor) return;

    const content = getEditorContent();
    const currentFilePath = getCurrentFilePath();

    if (!currentFilePath) {
      console.log("No current file path, calling saveFileAs");
      await saveFileAs();
      return;
    }

    try {
      if (!window.__TAURI__) {
        alert("Tauri not initialized");
        return;
      }
      const { invoke } = window.__TAURI__.core;
      console.log("Saving to:", currentFilePath);
      console.log("Content length:", content.length);
      const result = await invoke("save_file", {
        path: currentFilePath,
        content: content,
      });
      console.log("Save result:", result);
      clearUnsavedChanges();
    } catch (error) {
      console.error("Save error:", error);
      alert(`Could not save file: ${error}`);
    }
  }

  async function saveFileAs() {
    const editor = document.querySelector("#editor");
    if (!editor) return;

    const content = getEditorContent();
    const currentFilePath = getCurrentFilePath();
    const suggestedName = currentFilePath
      ? currentFilePath.split(/[\\/]/).pop()
      : "untitled.txt";

    try {
      if (!window.__TAURI__) {
        alert("Tauri not initialized");
        return;
      }
      const { invoke } = window.__TAURI__.core;
      console.log("Show save dialog, suggested:", suggestedName);

      let path;
      try {
        path = await invoke("show_save_dialog", {
          suggestedName: suggestedName,
        });
      } catch (invokeError) {
        console.error("Dialog invoke error:", invokeError);
        throw invokeError;
      }

      console.log("Dialog result:", path);
      if (!path) {
        console.log("No path selected, cancelling save");
        return;
      }

      console.log("Saving to:", path);
      console.log("Content length:", content.length);
      const result = await invoke("save_file", {
        path: path,
        content: content,
      });
      console.log("Save result:", result);

      setCurrentFilePath(path);
      clearUnsavedChanges();
      console.log("Save complete");
    } catch (error) {
      console.error("SaveFileAs error:", error);
      alert(`Could not save file: ${error}`);
    }
  }

  async function openFile() {
    if (!(await promptUnsavedChanges("opening a file"))) {
      return;
    }

    try {
      const { invoke } = window.__TAURI__.core;
      const path = await invoke("show_open_dialog");

      if (!path) return;

      const content = await invoke("open_file", {
        path: path,
      });

      const editor = document.querySelector("#editor");
      if (!editor) return;

      setCurrentFilePath(path);

      const selection = window.getSelection();
      if (selection) {
        selection.removeAllRanges();
      }

      while (editor.firstChild) {
        editor.removeChild(editor.firstChild);
      }

      const paragraphs = content
        .split(/\n\s*\n+/)
        .filter((p) => p.trim().length > 0);

      if (paragraphs.length === 0) {
        editor.appendChild(createEmptyParagraph());
      } else {
        paragraphs.forEach((paragraphText) => {
          const paragraph = createParagraphFromText(paragraphText);
          editor.appendChild(paragraph);
        });
      }

      normalizeEditorStructure(editor);
      clearUnsavedChanges();
      updateUnsavedIndicator();
      editor.focus();
    } catch (error) {
      alert(`Could not open file: ${error}`);
    }
  }

  async function newFile() {
    if (!(await promptUnsavedChanges("creating a new file"))) {
      return;
    }

    const editor = document.querySelector("#editor");
    if (!editor) return;

    const selection = window.getSelection();
    if (selection) {
      selection.removeAllRanges();
    }

    while (editor.firstChild) {
      editor.removeChild(editor.firstChild);
    }
    editor.appendChild(createEmptyParagraph());
    setCurrentFilePath(null);
    clearUnsavedChanges();
    updateUnsavedIndicator();
    normalizeEditorStructure(editor);

    moveCaretToParagraphStart(editor.firstElementChild);
    editor.focus();
  }

  return {
    saveCurrentFile,
    saveFileAs,
    openFile,
    newFile,
  };
}
