import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
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
  article.innerHTML = DOMPurify.sanitize(html, { USE_PROFILES: { html: true }, SANITIZE_NAMED_PROPS: true, FORBID_TAGS: ['base','button','embed','form','iframe','input','link','meta','object','style','textarea'], FORBID_ATTR: ['srcdoc','style'] });
  article.querySelectorAll('[data-math-id]').forEach(el => { const m = math.get(el.dataset.mathId); if (m) el.textContent = m.display ? `\\[${m.tex}\\]` : `\\(${m.tex}\\)`; });
  $('#welcome').hidden = true; article.hidden = false; $('#filename').textContent = doc.name; $('#status').textContent = ''; document.title = `${doc.name} — SigmaDown`;
  const toc = $('#toc'); toc.replaceChildren();
  article.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach((h, i) => { h.id = `section-${i}`; const a = document.createElement('a'); a.href = `#${h.id}`; a.textContent = h.textContent; a.className = `level-${h.tagName[1]}`; toc.append(a); });
  article.querySelectorAll('pre code:not(.language-mermaid)').forEach(el => hljs.highlightElement(el));
  article.querySelectorAll('pre:not(:has(.language-mermaid))').forEach(pre => { const b = document.createElement('button'); b.className = 'copy'; b.textContent = '复制'; b.addEventListener('click', async () => { try { await navigator.clipboard.writeText(pre.querySelector('code')?.textContent || pre.textContent); b.textContent = '已复制'; setTimeout(() => b.textContent = '复制', 1500); } catch { b.textContent = '复制失败'; } }); pre.append(b); });
  if (article.querySelector('.math-slot')) { try { await loadMath(); if (current === generation) await window.MathJax.typesetPromise([article]); } catch { if (current === generation) $('#status').textContent = '公式渲染失败。'; } }
  const diagrams = [...article.querySelectorAll('pre code.language-mermaid')];
  if (diagrams.length) { try { mermaidLoader ||= import('mermaid'); const { default: mermaid } = await mermaidLoader; if (current !== generation) return; mermaid.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'strict' }); for (const [i, code] of diagrams.entries()) { try { const { svg } = await mermaid.render(`diagram-${current}-${i}`, code.textContent); if (current !== generation) return; const box = document.createElement('div'); box.className = 'diagram'; box.innerHTML = svg; code.parentElement.replaceWith(box); } catch { code.parentElement.insertAdjacentText('beforebegin', '图表渲染失败：'); } } } catch { if (current === generation) $('#status').textContent = '图表加载失败。'; } }
}
async function read(path) { try { await render(await invoke('read_document', { path })); } catch (e) { $('#status').textContent = String(e); } }
async function choose() { try { const path = await open({ multiple: false, filters: [{ name: 'Markdown', extensions: ['md','markdown','txt'] }] }); if (path) await read(path); } catch (e) { $('#status').textContent = `打开文件失败：${e}`; } }
$('#open').addEventListener('click', choose); $('#welcome-open').addEventListener('click', choose);
document.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') { e.preventDefault(); choose(); } });
article.addEventListener('click', e => { const a = e.target.closest('a'); if (a && !a.getAttribute('href')?.startsWith('#')) { e.preventDefault(); $('#status').textContent = '外部链接请复制后在浏览器中打开。'; } });
invoke('startup_file').then(path => { if (path) read(path); }).catch(() => {});
