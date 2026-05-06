const SYNTAX_POS_ORDER = ["noun", "verb", "adjective", "adverb", "conjunction"];

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

function getRangesSignature(ranges) {
  return ranges
    .map((range) => `${range.start}:${range.end}:${range.posClass}`)
    .join("|");
}

export function createSyntaxHighlighter({
  editor,
  nlpEngine,
  initialSyntaxPosSettings,
  getContainersForParagraph,
}) {
  let syntaxPosSettings = { ...(initialSyntaxPosSettings || {}) };
  let syntaxParseCache = new Map();
  let containerState = new WeakMap();
  let dirtyQueue = new Set();
  let dirtyRaf = null;
  let syntaxRefreshToken = 0;
  let backgroundRaf = null;

  function getSyntaxSettingsKey() {
    return SYNTAX_POS_ORDER.map(
      (key) => `${key}:${syntaxPosSettings[key] ? 1 : 0}`,
    ).join("|");
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
    if (!text || typeof nlpEngine !== "function") {
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
    containerState.delete(element);
  }

  function applyContainer(container, options = {}) {
    const { force = false } = options;
    if (!(container instanceof HTMLElement)) {
      return false;
    }

    if (force) {
      containerState.delete(container);
    }

    const text = container.textContent || "";
    const settingsKey = getSyntaxSettingsKey();
    const ranges = text.trim() ? getSyntaxRangesForText(text) : [];
    const signature = getRangesSignature(ranges);
    const previousState = containerState.get(container);

    if (
      previousState &&
      previousState.text === text &&
      previousState.signature === signature &&
      previousState.settingsKey === settingsKey
    ) {
      return false;
    }

    clearSyntaxHighlightsInElement(container);

    if (ranges.length > 0) {
      container.textContent = "";
      container.appendChild(buildSyntaxFragment(text, ranges));
    }

    containerState.set(container, {
      text,
      signature,
      settingsKey,
    });

    return true;
  }

  function applyParagraph(paragraph, options = {}) {
    const { preserveSelection = false, force = false } = options;
    if (!(paragraph instanceof HTMLElement)) {
      return false;
    }

    const selectionOffsets = preserveSelection
      ? saveSelectionOffsetsForParagraph(paragraph)
      : null;

    const containers = getContainersForParagraph(paragraph);
    let changed = false;

    containers.forEach((container) => {
      changed = applyContainer(container, { force }) || changed;
    });

    if (preserveSelection && changed && selectionOffsets) {
      restoreSelectionOffsetsForParagraph(paragraph, selectionOffsets);
    }

    return changed;
  }

  function clearParagraph(paragraph) {
    if (!(paragraph instanceof HTMLElement)) {
      return;
    }

    const containers = getContainersForParagraph(paragraph);
    if (containers.length === 0) {
      clearSyntaxHighlightsInElement(paragraph);
      return;
    }

    containers.forEach((container) =>
      clearSyntaxHighlightsInElement(container),
    );
  }

  function clearAll(exceptParagraph = null) {
    const paragraphs = Array.from(
      editor.querySelectorAll(":scope > .editor-paragraph"),
    );

    paragraphs.forEach((paragraph) => {
      if (exceptParagraph && paragraph === exceptParagraph) {
        return;
      }
      clearParagraph(paragraph);
    });
  }

  function processDirtyQueue() {
    dirtyRaf = null;

    const queueItems = Array.from(dirtyQueue);
    if (queueItems.length === 0) {
      return;
    }

    dirtyQueue = new Set();
    const chunkStart = performance.now();
    let index = 0;

    while (index < queueItems.length && performance.now() - chunkStart <= 6) {
      applyParagraph(queueItems[index], { preserveSelection: false });
      index += 1;
    }

    while (index < queueItems.length) {
      dirtyQueue.add(queueItems[index]);
      index += 1;
    }

    if (dirtyQueue.size > 0) {
      dirtyRaf = window.requestAnimationFrame(processDirtyQueue);
    }
  }

  function queueParagraph(paragraph) {
    if (!(paragraph instanceof HTMLElement)) {
      return;
    }

    dirtyQueue.add(paragraph);
    if (dirtyRaf === null) {
      dirtyRaf = window.requestAnimationFrame(processDirtyQueue);
    }
  }

  function scheduleBackgroundRefresh(paragraphs, options = {}) {
    const { excludeParagraph = null } = options;

    syntaxRefreshToken += 1;
    const currentToken = syntaxRefreshToken;
    const queuedParagraphs = paragraphs.filter(
      (paragraph) => paragraph !== excludeParagraph,
    );

    let index = 0;
    const processChunk = () => {
      if (currentToken !== syntaxRefreshToken) {
        return;
      }

      const chunkStart = performance.now();
      while (
        index < queuedParagraphs.length &&
        performance.now() - chunkStart < 8
      ) {
        const paragraph = queuedParagraphs[index];
        index += 1;
        applyParagraph(paragraph, { preserveSelection: false });
      }

      if (index < queuedParagraphs.length) {
        backgroundRaf = window.requestAnimationFrame(processChunk);
      }
    };

    if (backgroundRaf !== null) {
      window.cancelAnimationFrame(backgroundRaf);
      backgroundRaf = null;
    }

    backgroundRaf = window.requestAnimationFrame(processChunk);
  }

  function setSettings(nextSettings) {
    syntaxPosSettings = { ...(nextSettings || {}) };
    syntaxParseCache.clear();
    containerState = new WeakMap();
  }

  function clearCache() {
    syntaxParseCache.clear();
  }

  return {
    applyParagraph,
    clearParagraph,
    clearAll,
    queueParagraph,
    scheduleBackgroundRefresh,
    setSettings,
    clearCache,
  };
}
