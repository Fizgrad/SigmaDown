import { sourceOffsetForText } from './markdown-map.js';

function selectionOffsetWithin(element, node, offset) {
  if (!node || !element.contains(node)) return null;
  try {
    const range = document.createRange();
    range.selectNodeContents(element);
    range.setEnd(node, offset);
    return range.toString().length;
  } catch { return null; }
}

function caretPositionFromPoint(x, y) {
  if (document.caretPositionFromPoint) {
    const position = document.caretPositionFromPoint(x, y);
    if (position) return { node: position.offsetNode, offset: position.offset };
  }
  const range = document.caretRangeFromPoint?.(x, y);
  return range ? { node: range.startContainer, offset: range.startOffset } : null;
}

function scrollEditorToCaret(editor, index) {
  const style = getComputedStyle(editor);
  const mirror = document.createElement('div');
  const properties = ['boxSizing', 'width', 'borderTopWidth', 'borderBottomWidth', 'borderLeftWidth', 'borderRightWidth', 'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight', 'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontVariant', 'lineHeight', 'letterSpacing', 'wordSpacing', 'textIndent', 'textTransform', 'tabSize'];
  for (const property of properties) mirror.style[property] = style[property];
  Object.assign(mirror.style, { position: 'fixed', visibility: 'hidden', top: '0', left: '-10000px', height: 'auto', overflow: 'hidden', whiteSpace: editor.wrap === 'off' ? 'pre' : 'pre-wrap', overflowWrap: 'break-word', borderStyle: 'solid' });
  mirror.textContent = editor.value.slice(0, index);
  const marker = document.createElement('span');
  marker.textContent = editor.value.slice(index, index + 1) || '\u200b';
  mirror.append(marker);
  document.body.append(mirror);
  const caretTop = marker.getBoundingClientRect().top - mirror.getBoundingClientRect().top;
  mirror.remove();
  const target = Math.max(0, caretTop - editor.clientHeight * 0.4);
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  editor.scrollTo({ top: target, behavior: reduced ? 'auto' : 'smooth' });
}

export function installPreviewSync({ article, editor, isEditing, getRenderedSource }) {
  let frame;
  let timer;
  let decoder;
  const clearHighlight = () => globalThis.CSS?.highlights?.delete('sigmadown-preview-selection');
  article.addEventListener('pointerdown', clearHighlight);
  editor.addEventListener('input', clearHighlight);
  const decode = value => {
    decoder ||= document.createElement('textarea');
    decoder.innerHTML = value;
    return decoder.value;
  };
  article.addEventListener('pointerup', event => {
    if (event.button !== 0 || !isEditing() || event.target.closest('button, .diagram, .math-slot, mjx-container')) return;
    const x = event.clientX, y = event.clientY;
    const selectionAtRelease = window.getSelection();
    const hasSelection = selectionAtRelease && !selectionAtRelease.isCollapsed && article.contains(selectionAtRelease.focusNode);
    if (!hasSelection && event.target.closest('a')) return;
    clearTimeout(timer);
    cancelAnimationFrame(frame);
    timer = setTimeout(() => { frame = requestAnimationFrame(() => {
      if (!isEditing()) return;
      const source = getRenderedSource();
      if (source !== editor.value) return; // preview has not caught up with typing
      const selection = window.getSelection();
      let position = selection && article.contains(selection.focusNode)
        ? { node: selection.focusNode, offset: selection.focusOffset } : caretPositionFromPoint(x, y);
      if (!position?.node) return;
      const element = (position.node.nodeType === Node.ELEMENT_NODE ? position.node : position.node.parentElement)?.closest('[data-source-start][data-source-end]');
      if (!element || !article.contains(element)) return;
      const start = Number(element.dataset.sourceStart), end = Number(element.dataset.sourceEnd);
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end > source.length) return;
      const visibleOffset = selectionOffsetWithin(element, position.node, position.offset);
      if (visibleOffset === null) return;
      let visible = element.textContent;
      // Marked appends one display newline to fenced code blocks.
      if (element.matches('pre > code') && visible.endsWith('\n') && !source.slice(start, end).endsWith('\n')) visible = visible.slice(0, -1);
      const relative = sourceOffsetForText(source.slice(start, end), visible, Math.min(visibleOffset, visible.length), decode);
      if (relative === null) return;
      if (selection && !selection.isCollapsed && globalThis.CSS?.highlights && globalThis.Highlight) {
        try { CSS.highlights.set('sigmadown-preview-selection', new Highlight(selection.getRangeAt(0).cloneRange())); } catch { /* Highlight API is optional. */ }
      }
      const previousScroll = editor.scrollTop;
      editor.focus({ preventScroll: true });
      editor.setSelectionRange(start + relative, start + relative);
      editor.scrollTop = previousScroll;
      scrollEditorToCaret(editor, start + relative);
    }); }, hasSelection ? 0 : 180);
  });
}
