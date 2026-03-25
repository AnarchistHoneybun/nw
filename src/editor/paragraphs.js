export function createEmptyParagraph() {
  const paragraph = document.createElement("div");
  paragraph.classList.add("editor-paragraph");
  paragraph.appendChild(document.createElement("br"));
  return paragraph;
}

export function ensureParagraphPlaceholder(paragraph) {
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

function hasNestedBlockContent(paragraph) {
  if (!(paragraph instanceof HTMLElement)) {
    return false;
  }

  const blockSelectors = [
    "div",
    "p",
    "section",
    "article",
    "blockquote",
    "ul",
    "ol",
    "li",
    "pre",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
  ];

  return blockSelectors.some((selector) => paragraph.querySelector(selector));
}

function expandNestedParagraph(paragraph) {
  const normalized = (paragraph.innerText || "").replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");

  if (lines.length === 0) {
    return [createEmptyParagraph()];
  }

  return lines.map((line) =>
    line.length > 0 ? createParagraphFromText(line) : createEmptyParagraph(),
  );
}

export function normalizeEditorStructure(editor) {
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

    if (hasNestedBlockContent(node)) {
      const replacementParagraphs = expandNestedParagraph(node);
      const fragment = document.createDocumentFragment();
      replacementParagraphs.forEach((paragraph) => {
        fragment.appendChild(paragraph);
      });
      editor.replaceChild(fragment, node);
    }
  }

  if (editor.children.length === 0) {
    editor.appendChild(createEmptyParagraph());
    return;
  }

  for (const child of Array.from(editor.children)) {
    ensureParagraphPlaceholder(child);
  }
}

export function createParagraphFromText(text) {
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

export function splitTextIntoParagraphs(text) {
  const normalized = text.replace(/\r\n?/g, "\n").trimEnd();
  if (!normalized) {
    return [];
  }

  const paragraphs = normalized.split(/\n\s*\n+/);
  return paragraphs.map((paragraphText) =>
    createParagraphFromText(paragraphText),
  );
}

export function createParagraphFromFragment(fragment) {
  const paragraph = document.createElement("div");
  paragraph.classList.add("editor-paragraph");
  paragraph.appendChild(fragment);
  ensureParagraphPlaceholder(paragraph);
  return paragraph;
}

export function getEditorContent() {
  const editor = document.querySelector("#editor");
  if (!editor) return "";

  const paragraphElements = Array.from(editor.children).filter((child) =>
    child.classList.contains("editor-paragraph"),
  );

  const paragraphs = paragraphElements.map((para) => {
    const lines = [];
    for (const node of para.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent || "";
        if (text.length > 0) {
          lines.push(text);
        }
      } else if (
        node.nodeType === Node.ELEMENT_NODE &&
        node.nodeName === "BR"
      ) {
        lines.push("\n");
      }
    }
    return lines.join("");
  });

  return paragraphs.join("\n\n");
}
