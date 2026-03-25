const FOCUS_MODE_STORAGE_KEY = "nw.focusMode";

function readFocusModePreference() {
  return localStorage.getItem(FOCUS_MODE_STORAGE_KEY) === "true";
}

function writeFocusModePreference(enabled) {
  localStorage.setItem(FOCUS_MODE_STORAGE_KEY, String(enabled));
}

function createEmptyParagraph() {
  const paragraph = document.createElement("div");
  paragraph.classList.add("editor-paragraph");
  paragraph.appendChild(document.createElement("br"));
  return paragraph;
}

function ensureParagraphPlaceholder(paragraph) {
  if (!(paragraph instanceof HTMLElement)) {
    return;
  }

  paragraph.classList.add("editor-paragraph");

  if (paragraph.childNodes.length === 0) {
    paragraph.appendChild(document.createElement("br"));
    return;
  }

  const hasVisibleContent = Array.from(paragraph.childNodes).some((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent?.length > 0;
    }
    if (node.nodeType === Node.ELEMENT_NODE) {
      return node.nodeName !== "BR";
    }
    return false;
  });

  const hasBreak = Array.from(paragraph.childNodes).some(
    (node) => node.nodeName === "BR",
  );

  if (!hasVisibleContent && !hasBreak) {
    paragraph.appendChild(document.createElement("br"));
  }
}

function normalizeEditorStructure(editor) {
  if (editor.childNodes.length === 0) {
    editor.appendChild(createEmptyParagraph());
    return;
  }

  for (const node of Array.from(editor.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      if ((node.textContent || "").trim().length === 0) {
        node.remove();
        continue;
      }

      const paragraph = createEmptyParagraph();
      paragraph.innerHTML = "";
      paragraph.appendChild(document.createTextNode(node.textContent || ""));
      editor.replaceChild(paragraph, node);
      continue;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      node.remove();
      continue;
    }

    ensureParagraphPlaceholder(node);
  }

  if (editor.children.length === 0) {
    editor.appendChild(createEmptyParagraph());
    return;
  }

  for (const child of Array.from(editor.children)) {
    ensureParagraphPlaceholder(child);
  }
}

function moveCaretToParagraphStart(paragraph) {
  const selection = window.getSelection();
  if (!selection || !(paragraph instanceof HTMLElement)) {
    return;
  }

  const range = document.createRange();
  range.setStart(paragraph, 0);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

function getSelectionRangeInEditor(editor) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return null;
  }

  const range = selection.getRangeAt(0);
  if (
    !editor.contains(range.startContainer) ||
    !editor.contains(range.endContainer)
  ) {
    return null;
  }

  return range;
}

function getTopLevelParagraphForNode(editor, node) {
  if (!node) {
    return null;
  }

  let current = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
  if (!(current instanceof Element) || !editor.contains(current)) {
    return null;
  }

  while (current && current.parentElement !== editor) {
    current = current.parentElement;
  }

  if (!(current instanceof HTMLElement) || current.parentElement !== editor) {
    return null;
  }

  return current;
}

function isEffectivelyEmptyParagraph(paragraph) {
  if (!(paragraph instanceof HTMLElement)) {
    return false;
  }

  for (const node of Array.from(paragraph.childNodes)) {
    if (
      node.nodeType === Node.TEXT_NODE &&
      (node.textContent || "").trim().length > 0
    ) {
      return false;
    }

    if (node.nodeType === Node.ELEMENT_NODE && node.nodeName !== "BR") {
      return false;
    }
  }

  return true;
}

function placeCaretAtEditorEnd(editor) {
  const selection = window.getSelection();
  if (!selection) {
    return;
  }

  const lastParagraph = editor.lastElementChild;
  if (!(lastParagraph instanceof HTMLElement)) {
    return;
  }

  const range = document.createRange();
  range.selectNodeContents(lastParagraph);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

function createParagraphFromText(text) {
  const paragraph = document.createElement("div");
  paragraph.classList.add("editor-paragraph");

  const normalized = text.replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");

  lines.forEach((line, index) => {
    if (line.length > 0) {
      paragraph.appendChild(document.createTextNode(line));
    }

    if (index < lines.length - 1) {
      paragraph.appendChild(document.createElement("br"));
    }
  });

  if (paragraph.childNodes.length === 0) {
    paragraph.appendChild(document.createElement("br"));
  }

  return paragraph;
}

function splitTextIntoParagraphs(text) {
  const normalized = text.replace(/\r\n?/g, "\n").trimEnd();
  if (!normalized) {
    return [];
  }

  const paragraphs = normalized.split(/\n\s*\n+/);
  return paragraphs.map((paragraphText) =>
    createParagraphFromText(paragraphText),
  );
}

function setCaretToParagraphEnd(paragraph) {
  if (!(paragraph instanceof HTMLElement)) {
    return;
  }

  const selection = window.getSelection();
  if (!selection) {
    return;
  }

  const range = document.createRange();
  range.selectNodeContents(paragraph);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

function createParagraphFromFragment(fragment) {
  const paragraph = document.createElement("div");
  paragraph.classList.add("editor-paragraph");
  paragraph.appendChild(fragment);
  ensureParagraphPlaceholder(paragraph);
  return paragraph;
}

function insertParagraphsAtSelection(editor, paragraphs) {
  if (!Array.isArray(paragraphs) || paragraphs.length === 0) {
    return null;
  }

  let range = getSelectionRangeInEditor(editor);
  if (!range) {
    placeCaretAtEditorEnd(editor);
    range = getSelectionRangeInEditor(editor);
  }

  if (!range) {
    return null;
  }

  if (!range.collapsed) {
    range.deleteContents();
    normalizeEditorStructure(editor);
    ensureValidCaret(editor);
    range = getSelectionRangeInEditor(editor);
    if (!range) {
      placeCaretAtEditorEnd(editor);
      range = getSelectionRangeInEditor(editor);
    }
    if (!range) {
      return null;
    }
  }

  let startParagraph = getTopLevelParagraphForNode(
    editor,
    range.startContainer,
  );

  if (
    range.collapsed &&
    startParagraph &&
    isEffectivelyEmptyParagraph(startParagraph)
  ) {
    const fragment = document.createDocumentFragment();
    paragraphs.forEach((paragraph) => {
      fragment.appendChild(paragraph);
    });

    const lastInsertedParagraph = paragraphs[paragraphs.length - 1];
    startParagraph.before(fragment);
    startParagraph.remove();
    setCaretToParagraphEnd(lastInsertedParagraph);
    return lastInsertedParagraph;
  }

  if (!startParagraph) {
    const fragment = document.createDocumentFragment();
    paragraphs.forEach((paragraph) => {
      fragment.appendChild(paragraph);
    });

    const lastInsertedParagraph = paragraphs[paragraphs.length - 1];
    editor.appendChild(fragment);
    setCaretToParagraphEnd(lastInsertedParagraph);
    return lastInsertedParagraph;
  }

  const trailingRange = document.createRange();
  trailingRange.selectNodeContents(startParagraph);
  trailingRange.setStart(range.startContainer, range.startOffset);
  const trailingFragment = trailingRange.extractContents();

  ensureParagraphPlaceholder(startParagraph);

  const fragment = document.createDocumentFragment();
  paragraphs.forEach((paragraph) => {
    fragment.appendChild(paragraph);
  });

  const lastInsertedParagraph = paragraphs[paragraphs.length - 1];
  startParagraph.after(fragment);

  const trailingParagraph = createParagraphFromFragment(trailingFragment);
  if (!isEffectivelyEmptyParagraph(trailingParagraph)) {
    lastInsertedParagraph.after(trailingParagraph);
  }

  setCaretToParagraphEnd(lastInsertedParagraph);

  return lastInsertedParagraph;
}

function insertPlainTextAtSelection(editor, text) {
  if (!text) {
    return;
  }

  const paragraphs = splitTextIntoParagraphs(text);
  if (paragraphs.length > 0) {
    insertParagraphsAtSelection(editor, paragraphs);
    return;
  }

  let range = getSelectionRangeInEditor(editor);
  if (!range) {
    placeCaretAtEditorEnd(editor);
    range = getSelectionRangeInEditor(editor);
  }

  if (!range) {
    return;
  }

  const inserted = document.execCommand("insertText", false, text);
  if (inserted) {
    return;
  }

  range.deleteContents();
  const textNode = document.createTextNode(text);
  range.insertNode(textNode);
  const selection = window.getSelection();
  if (!selection) {
    return;
  }

  const collapseRange = document.createRange();
  collapseRange.setStart(textNode, textNode.textContent?.length ?? 0);
  collapseRange.collapse(true);
  selection.removeAllRanges();
  selection.addRange(collapseRange);
}

function ensureValidCaret(editor) {
  if (!(document.activeElement === editor)) {
    return;
  }

  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return;
  }

  const anchorNode = selection.anchorNode;
  if (!anchorNode || !editor.contains(anchorNode)) {
    return;
  }

  const activeParagraph = getActiveParagraph(editor);
  if (activeParagraph) {
    return;
  }

  const firstParagraph = editor.querySelector(":scope > .editor-paragraph");
  moveCaretToParagraphStart(firstParagraph);
}

function getActiveParagraph(editor) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return null;
  }

  let node = selection.anchorNode;
  if (!node || !editor.contains(node)) {
    return null;
  }

  if (node.nodeType === Node.TEXT_NODE) {
    node = node.parentElement;
  }

  if (!(node instanceof Element)) {
    return null;
  }

  let current = node;
  while (current && current.parentElement !== editor) {
    current = current.parentElement;
  }

  if (!current || current.parentElement !== editor) {
    return null;
  }

  return current;
}

function setActiveParagraph(editor, paragraph) {
  for (const element of editor.children) {
    element.classList.remove("is-active-paragraph");
  }

  if (paragraph instanceof Element) {
    paragraph.classList.add("is-active-paragraph");
  }
}

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
    updateFocusParagraph();
  });
  editor.addEventListener("keydown", (event) => {
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

  applyFocusMode(focusModeEnabled);
  editor.focus();
});
