import {
  createParagraphFromFragment,
  ensureParagraphPlaceholder,
  normalizeEditorStructure,
  splitTextIntoParagraphs,
} from "./paragraphs.js";

export function moveCaretToParagraphStart(paragraph) {
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

export function getSelectionRangeInEditor(editor) {
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

export function getTopLevelParagraphForNode(editor, node) {
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

export function isEffectivelyEmptyParagraph(paragraph) {
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

export function placeCaretAtEditorEnd(editor) {
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

export function setCaretToParagraphEnd(paragraph) {
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

export function getActiveParagraph(editor) {
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

export function setActiveParagraph(editor, paragraph) {
  for (const element of editor.children) {
    element.classList.remove("is-active-paragraph");
  }

  if (paragraph instanceof Element) {
    paragraph.classList.add("is-active-paragraph");
  }
}

export function ensureValidCaret(editor) {
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

export function insertParagraphsAtSelection(editor, paragraphs) {
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

export function insertPlainTextAtSelection(editor, text) {
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

export function splitParagraphAtSelection(editor) {
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
      return null;
    }
  }

  const startParagraph = getTopLevelParagraphForNode(
    editor,
    range.startContainer,
  );
  if (!startParagraph) {
    return null;
  }

  const trailingRange = document.createRange();
  trailingRange.selectNodeContents(startParagraph);
  trailingRange.setStart(range.startContainer, range.startOffset);
  const trailingFragment = trailingRange.extractContents();

  ensureParagraphPlaceholder(startParagraph);

  const newParagraph = createParagraphFromFragment(trailingFragment);
  startParagraph.after(newParagraph);
  moveCaretToParagraphStart(newParagraph);

  return newParagraph;
}
