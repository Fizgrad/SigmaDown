const STORAGE_KEY = 'sigmadown.pane-widths.v1';
const SIDEBAR_MIN = 112;
const SIDEBAR_MAX = 420;
const EDITOR_MIN = 160;
const PREVIEW_MIN = 220;
const DIVIDER_SIZE = 8;

const clamp = (value, min, max) => Math.min(Math.max(value, min), Math.max(min, max));

export function createPaneLayout({ container, sidebarSplitter, editorSplitter }) {
  let preferred = {};
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    if (Number.isFinite(saved.sidebar) && saved.sidebar > 0) preferred.sidebar = saved.sidebar;
    if (Number.isFinite(saved.editor) && saved.editor > 0) preferred.editor = saved.editor;
  } catch { /* Layout remains usable when storage is unavailable. */ }
  let editing = false;
  let widths = { sidebar: 240, editor: 360 };

  function limits() {
    const total = container.clientWidth;
    const splitters = DIVIDER_SIZE * (editing ? 2 : 1);
    const sidebarMax = Math.min(SIDEBAR_MAX, total - splitters - PREVIEW_MIN - (editing ? EDITOR_MIN : 0));
    return { total, sidebarMax: Math.max(SIDEBAR_MIN, sidebarMax), splitters };
  }
  function update() {
    const { total, sidebarMax, splitters } = limits();
    if (!total) return;
    widths.sidebar = clamp(preferred.sidebar ?? 240, SIDEBAR_MIN, sidebarMax);
    const editorMax = Math.max(EDITOR_MIN, total - splitters - PREVIEW_MIN - widths.sidebar);
    widths.editor = clamp(preferred.editor ?? total * 0.4, EDITOR_MIN, editorMax);
    container.style.setProperty('--sidebar-width', `${widths.sidebar}px`);
    container.style.setProperty('--editor-width', `${widths.editor}px`);
    sidebarSplitter.setAttribute('aria-valuemin', String(SIDEBAR_MIN));
    sidebarSplitter.setAttribute('aria-valuemax', String(Math.round(sidebarMax)));
    sidebarSplitter.setAttribute('aria-valuenow', String(Math.round(widths.sidebar)));
    editorSplitter.setAttribute('aria-valuemin', String(EDITOR_MIN));
    editorSplitter.setAttribute('aria-valuemax', String(Math.round(editorMax)));
    editorSplitter.setAttribute('aria-valuenow', String(Math.round(widths.editor)));
  }
  function persist() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(preferred)); } catch { /* Private mode can disable storage. */ }
  }
  function setWidth(pane, value) {
    const { total, sidebarMax, splitters } = limits();
    const max = pane === 'sidebar' ? sidebarMax : total - splitters - PREVIEW_MIN - widths.sidebar;
    preferred[pane] = clamp(value, pane === 'sidebar' ? SIDEBAR_MIN : EDITOR_MIN, max);
    update();
  }
  function bind(handle, pane) {
    let drag;
    handle.addEventListener('pointerdown', event => {
      if (event.button !== 0 || !event.isPrimary) return;
      event.preventDefault();
      drag = { id: event.pointerId, x: event.clientX, width: widths[pane] };
      handle.setPointerCapture(event.pointerId);
      handle.classList.add('is-dragging');
      document.body.classList.add('is-resizing-panes');
    });
    handle.addEventListener('pointermove', event => {
      if (drag && event.pointerId === drag.id) setWidth(pane, drag.width + event.clientX - drag.x);
    });
    function finish(event) {
      if (!drag || event.pointerId !== drag.id) return;
      drag = null;
      handle.classList.remove('is-dragging');
      document.body.classList.remove('is-resizing-panes');
      persist();
    }
    handle.addEventListener('pointerup', finish);
    handle.addEventListener('pointercancel', finish);
    handle.addEventListener('lostpointercapture', finish);
    handle.addEventListener('keydown', event => {
      const step = event.shiftKey ? 40 : 10;
      let value;
      if (event.key === 'ArrowLeft') value = widths[pane] - step;
      else if (event.key === 'ArrowRight') value = widths[pane] + step;
      else if (event.key === 'Home') value = 0;
      else if (event.key === 'End') value = Infinity;
      else return;
      event.preventDefault();
      setWidth(pane, value);
      persist();
    });
  }
  bind(sidebarSplitter, 'sidebar');
  bind(editorSplitter, 'editor');
  const observer = new ResizeObserver(update);
  observer.observe(container);
  update();
  return {
    setEditing(value) {
      if (editing === value) return;
      editing = value;
      editorSplitter.hidden = !editing;
      update();
    }
  };
}
