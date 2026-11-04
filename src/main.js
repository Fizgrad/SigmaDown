import { invoke } from '@tauri-apps/api/core';
import { open, save as saveDialog, confirm } from '@tauri-apps/plugin-dialog';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { createCloseHandler } from './window-close.js';
import { createPaneLayout } from './pane-layout.js';
import { createHeadingIds, detectLineEnding, serializeText } from './document-format.js';
import { openDocumentSafely } from './open-document.js';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js';
import 'github-markdown-css/github-markdown-dark.css';
import 'highlight.js/styles/github-dark.css';
import './style.css';

const $ = (s) => document.querySelector(s);
const article = $('#document');
let generation = 0;
let math = new Map();
let mathId = 0;
let mathLoader;
let mermaidLoader;
const diagramCache = new Map();
function slot(tex, display) {
  const id = String(mathId++);
  math.set(id, { tex, display });
  return `<${display ? 'div' : 'span'} class="math-slot" data-math-id="${id}"></${display ? 'div' : 'span'}>`;
}
marked.use({ extensions: [
  { name: 'math', level: 'block', start: s => { const a = s.indexOf('$$'), b = s.indexOf('\\['); return a < 0 ? b : b < 0 ? a : Math.min(a, b); }, tokenizer(s) { const m = s.match(/^\$\$([\s\S]*?)\$\$/) || s.match(/^\\\[([\s\S]*?)\\\]/); if (m) return { type: 'math', raw: m[0], html: slot(m[1].trim(), true) }; }, renderer: t => t.html },
  { name: 'inlineMath', level: 'inline', start: s => { const m = s.match(/\\\(|\$(?!\$)/); return m?.index; }, tokenizer(s) { let end; if (s.startsWith('\\(')) { end = s.indexOf('\\)', 2); if (end >= 0) return { type: 'inlineMath', raw: s.slice(0, end + 2), html: slot(s.slice(2, end).trim(), false) }; } else if (s[0] === '$' && s[1] !== '$') { end = s.indexOf('$', 1); if (end > 0 && s[end - 1] !== '\\') return { type: 'inlineMath', raw: s.slice(0, end + 1), html: slot(s.slice(1, end).trim(), false) }; } }, renderer: t => t.html }
] });
function loadMath() {
  if (!mathLoader) {
    window.MathJax = { startup: { typeset: false }, tex: { inlineMath: [['$', '$'], ['\\(', '\\)']], displayMath: [['$$', '$$'], ['\\[', '\\]']], processEscapes: true } };
    mathLoader = new Promise((resolve, reject) => { const s = document.createElement('script'); s.src = '/vendor/mathjax/tex-mml-chtml.js'; s.onload = () => window.MathJax.startup.promise.then(resolve, reject); s.onerror = reject; document.head.appendChild(s); });
  }
  return mathLoader;
}
async function render(doc) {
  const current = ++generation;
  math.clear(); mathId = 0;
  const html = marked.parse(doc.content);
  if (window.MathJax?.typesetClear) window.MathJax.typesetClear([article]);
  article.innerHTML = DOMPurify.sanitize(html, { USE_PROFILES: { html: true }, SANITIZE_NAMED_PROPS: true, FORBID_TAGS: ['base','button','embed','form','iframe','input','link','meta','object','style','textarea'], FORBID_ATTR: ['srcdoc','style'] });
  article.querySelectorAll('[data-math-id]').forEach(el => { const m = math.get(el.dataset.mathId); if (m) el.textContent = m.display ? `\\[${m.tex}\\]` : `\\(${m.tex}\\)`; });
  $('#welcome').hidden = true; article.hidden = false;
  const toc = $('#toc'); toc.replaceChildren();
  const headings = [...article.querySelectorAll('h1,h2,h3,h4,h5,h6')];
  const ids = createHeadingIds(headings.map(h => h.textContent));
  headings.forEach((h, i) => { h.id = ids[i]; const a = document.createElement('a'); a.href = `#${encodeURIComponent(h.id)}`; a.textContent = h.textContent; a.className = `level-${h.tagName[1]}`; toc.append(a); });
  article.querySelectorAll('pre code:not(.language-mermaid)').forEach(el => hljs.highlightElement(el));
  article.querySelectorAll('pre:not(:has(.language-mermaid))').forEach(pre => { const b = document.createElement('button'); b.className = 'copy'; b.textContent = '复制'; b.addEventListener('click', async () => { try { await navigator.clipboard.writeText(pre.querySelector('code')?.textContent || pre.textContent); b.textContent = '已复制'; setTimeout(() => b.textContent = '复制', 1500); } catch { b.textContent = '复制失败'; } }); pre.append(b); });
  if (article.querySelector('.math-slot')) { try { await loadMath(); if (current !== generation) return; await window.MathJax.typesetPromise([article]); if (current !== generation) return; } catch { if (current === generation) $('#status').textContent = '公式渲染失败。'; } }
  const diagrams = [...article.querySelectorAll('pre code.language-mermaid')];
  if (diagrams.length) { try { mermaidLoader ||= import('mermaid'); const { default: mermaid } = await mermaidLoader; if (current !== generation) return; mermaid.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'strict' }); for (const [i, code] of diagrams.entries()) { try { const key = `${i}\0${code.textContent}`; let svg = diagramCache.get(key); if (!svg) { ({ svg } = await mermaid.render(`diagram-${current}-${i}`, code.textContent)); if (current !== generation) return; if (diagramCache.size >= 32) diagramCache.delete(diagramCache.keys().next().value); diagramCache.set(key, svg); } if (current !== generation) return; const box = document.createElement('div'); box.className = 'diagram'; box.innerHTML = svg; code.parentElement.replaceWith(box); } catch { code.parentElement.insertAdjacentText('beforebegin', '图表渲染失败：'); } } } catch { if (current === generation) $('#status').textContent = '图表加载失败。'; } }
}
const editor = $('#editor');
const paneLayout = createPaneLayout({ container: document.querySelector('main'), sidebarSplitter: $('#sidebar-splitter'), editorSplitter: $('#editor-splitter') });
let documentState = null;
let editing = false;
let pendingSave = null;
let openRequest = 0;
let renderTimer;
let rendering = false;
let needsRender = false;

function isDirty() { return documentState && editor.value !== documentState.savedText; }
function updateDocumentUI() {
  const dirty = !!isDirty();
  $('#filename').textContent = documentState ? `${documentState.name}${dirty ? ' •' : ''}` : '未打开文件';
  document.title = documentState ? `${dirty ? '● ' : ''}${documentState.name} — SigmaDown` : 'SigmaDown';
  $('#edit-toggle').hidden = !documentState;
  $('#edit-toggle').textContent = editing ? '完成编辑' : '编辑';
  $('#edit-toggle').setAttribute('aria-pressed', String(editing));
  $('#editor-panel').hidden = !documentState || !editing;
  $('#save').hidden = !documentState || !editing;
  $('#save').disabled = !dirty || !!pendingSave;
  $('#save').title = dirty ? '保存更改' : '没有未保存的更改';
  document.body.classList.toggle('is-editing', !!documentState && editing);
  paneLayout.setEditing(!!documentState && editing);
}
function scheduleRender(immediate = false) {
  ++generation;
  needsRender = true;
  clearTimeout(renderTimer);
  renderTimer = setTimeout(runRender, immediate ? 0 : 350);
}
async function runRender() {
  if (rendering || !documentState || !needsRender) return;
  rendering = true;
  needsRender = false;
  const content = editor.value;
  try { await render({ content }); } catch (error) { $('#status').textContent = `预览失败：${error}`; }
  finally { rendering = false; if (needsRender) scheduleRender(true); }
}
async function discardChanges() {
  if (pendingSave) await pendingSave;
  if (!isDirty()) return true;
  try { return await confirm('当前文档有未保存的更改。放弃这些更改吗？', { title: '未保存的更改', kind: 'warning', okLabel: '放弃更改', cancelLabel: '继续编辑' }); }
  catch (error) { $('#status').textContent = `无法确认未保存的更改：${error}`; return false; }
}
function showDocument(doc, path, edit = false) {
  editor.value = doc.content;
  documentState = { name: doc.name, path, diskContent: path ? doc.content : null, savedText: path ? editor.value : null, lineEnding: detectLineEnding(doc.content) };
  editing = edit;
  $('#status').textContent = '';
  $('#welcome').hidden = true;
  article.hidden = false;
  updateDocumentUI();
  scheduleRender(true);
  if (edit) editor.focus();
}
async function read(path) {
  const request = ++openRequest;
  try {
    const result = await openDocumentSafely({
      load: () => invoke('read_document', { path }),
      getState: () => documentState,
      getText: () => editor.value,
      isCurrent: () => request === openRequest,
      confirmDiscard: discardChanges,
      show: doc => showDocument(doc, path)
    });
    if (result === 'changed-again') $('#status').textContent = '文档在确认期间又被修改，已保留当前内容。';
  } catch (e) { if (request === openRequest) $('#status').textContent = String(e); }
}
async function choose() {
  if (!await discardChanges()) return;
  try { const path = await open({ multiple: false, filters: [{ name: 'Markdown', extensions: ['md','markdown','txt'] }] }); if (path) await read(path); }
  catch (e) { $('#status').textContent = `打开文件失败：${e}`; }
}
async function createDocument() {
  if (!await discardChanges()) return;
  ++openRequest;
  showDocument({ name: '未命名.md', content: '' }, null, true);
}
async function saveDocument() {
  if (!documentState || pendingSave || !isDirty()) return;
  const state = documentState;
  const snapshot = editor.value;
  pendingSave = (async () => {
    try {
      let path = state.path;
      if (!path) {
        path = await saveDialog({ defaultPath: 'untitled.md', filters: [{ name: 'Markdown', extensions: ['md','markdown','txt'] }] });
        if (!path) return;
      }
      const diskSnapshot = serializeText(snapshot, state.lineEnding);
      await invoke('save_document', { path, content: diskSnapshot, expected: state.diskContent });
      state.path = path;
      state.name = path.split(/[\\/]/).pop() || path;
      state.diskContent = diskSnapshot;
      state.savedText = snapshot;
      $('#status').textContent = '已保存';
    } catch (error) { $('#status').textContent = `保存失败：${error}`; }
  })();
  updateDocumentUI();
  await pendingSave;
  pendingSave = null;
  updateDocumentUI();
}
$('#open').addEventListener('click', choose); $('#welcome-open').addEventListener('click', choose);
$('#new-document').addEventListener('click', createDocument); $('#welcome-new').addEventListener('click', createDocument);
$('#save').addEventListener('click', saveDocument);
$('#edit-toggle').addEventListener('click', () => { editing = !editing; updateDocumentUI(); if (editing) editor.focus(); });
editor.addEventListener('input', () => { $('#status').textContent = ''; updateDocumentUI(); scheduleRender(); });
document.addEventListener('keydown', e => {
  if (!(e.ctrlKey || e.metaKey)) return;
  if (e.key.toLowerCase() === 'o') { e.preventDefault(); choose(); }
  if (e.key.toLowerCase() === 's') { e.preventDefault(); saveDocument(); }
});
function navigateFragment(event, anchor) {
  const href = anchor.getAttribute('href');
  if (!href?.startsWith('#')) return false;
  event.preventDefault();
  let id;
  try { id = decodeURIComponent(href.slice(1)); } catch { return true; }
  const target = [...article.querySelectorAll('[id]')].find(node => node.id === id || node.id === `user-content-${id}`);
  if (target) target.scrollIntoView({ block: 'start' });
  return true;
}
$('#toc').addEventListener('click', event => {
  const anchor = event.target.closest('a');
  if (anchor) navigateFragment(event, anchor);
});
article.addEventListener('click', event => {
  const anchor = event.target.closest('a');
  if (anchor && !navigateFragment(event, anchor)) {
    event.preventDefault();
    $('#status').textContent = '外部链接请复制后在浏览器中打开。';
  }
});
invoke('startup_file').then(path => { if (path && !documentState) read(path); }).catch(() => {});

const appWindow = getCurrentWindow();
for (const [id, action] of [['minimize', 'minimize'], ['maximize', 'toggleMaximize'], ['close', 'close']]) {
  document.getElementById(id).addEventListener('click', () => appWindow[action]().catch(error => { $('#status').textContent = `窗口操作失败：${error}`; }));
}
document.querySelectorAll('[data-resize]').forEach(handle => handle.addEventListener('mousedown', event => {
  if (event.button === 0) appWindow.startResizeDragging(handle.dataset.resize).catch(error => { $('#status').textContent = `调整窗口大小失败：${error}`; });
}));

appWindow.onCloseRequested(createCloseHandler({
  needsConfirmation: () => !!isDirty() || !!pendingSave,
  confirmDiscard: discardChanges,
  destroy: () => appWindow.destroy(),
  reportError: error => { $('#status').textContent = `关闭窗口失败：${error}`; }
})).catch(error => { $('#status').textContent = `无法监听窗口关闭：${error}`; });
