import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Marked } from 'marked';
import { annotateSourceTokens, installSourceMapping, installCompatibleStrong, sourceOffsetForText } from '../src/markdown-map.js';

function render(source) {
  const marked = new Marked();
  installCompatibleStrong(marked);
  installSourceMapping(marked);
  const tokens = marked.lexer(source);
  annotateSourceTokens(tokens, source);
  return marked.parser(tokens);
}

test('ordinary, Chinese and whitespace-padded strong text renders correctly', () => {
  const html = render('中文**重点**中文，** 包含空格 **。普通 ** ** 保持原样。');
  assert.match(html, /<strong><span[^>]*>重点<\/span><\/strong>/);
  assert.match(html, /<strong><span[^>]*> 包含空格 <\/span><\/strong>/);
  assert.ok(html.includes('** **'));
});

test('text source ranges distinguish duplicate words, nested formatting and links', () => {
  const source = '# 标题 **重复** 后面 [重复](https://example.com)\n\n- **重复**';
  const html = render(source);
  const ranges = [...html.matchAll(/data-source-start="(\d+)" data-source-end="(\d+)">重复/g)].map(m => source.slice(+m[1], +m[2]));
  const offsets = [...html.matchAll(/data-source-start="(\d+)" data-source-end="(\d+)">重复/g)].map(m => +m[1]);
  assert.deepEqual(ranges, ['重复', '重复', '重复']);
  assert.deepEqual(offsets, [source.indexOf('重复'), source.indexOf('重复', source.indexOf('重复') + 1), source.lastIndexOf('重复')]);
});

test('inline and fenced code map the displayed content, not Markdown delimiters', () => {
  const source = '`value`\n\n```js\nconst x = 1;\n```';
  const html = render(source);
  const ranges = [...html.matchAll(/<code data-source-start="(\d+)" data-source-end="(\d+)"/g)].map(m => source.slice(+m[1], +m[2]));
  assert.deepEqual(ranges, ['value', 'const x = 1;']);
});

test('caret mapping handles escapes, entities and supplementary Unicode', () => {
  const decode = text => ({ '&amp;': '&', '&#x1F600;': '😀' })[text] || text;
  assert.equal(sourceOffsetForText('A &amp; B', 'A & B', 3, decode), 7);
  assert.equal(sourceOffsetForText('\\*', '*', 0, decode), 1);
  assert.equal(sourceOffsetForText('&#x1F600;', '😀', 2, decode), 9);
  assert.equal(sourceOffsetForText('&amp;', '&amp;', 4, decode), 4);
  assert.equal(sourceOffsetForText('wrong', 'different', 2, decode), null);
});


test('Chinese bold text with full-width punctuation remains bold before Chinese prose', () => {
  const source = '量子程序通过**量子门（quantum gate）**改变这些概率幅与相位。入门时记住四种操作即可：';
  const html = render(source);
  assert.match(html, /<strong><span[^>]*>量子门（quantum gate）<\/span><\/strong>/);
  const range = /data-source-start="(\d+)" data-source-end="(\d+)">量子门/.exec(html);
  assert.equal(source.slice(+range[1], +range[2]), '量子门（quantum gate）');
  assert.match(render('中文**内容！**后面'), /<strong>/);
});

test('escaped closing stars do not start padded strong text', () => {
  const html = render('文字 ** 未闭合 \\** 后面');
  assert.doesNotMatch(html, /<strong>/);
});

test('the reported quantum-gate example renders in read mode alongside math extensions', async () => {
  const { createMathExtensions } = await import('../src/markdown-math.js');
  const marked = new Marked();
  installCompatibleStrong(marked);
  installSourceMapping(marked);
  marked.use({ extensions: createMathExtensions(() => '<span class="math-slot"></span>') });
  const html = marked.parse('量子程序通过**量子门（quantum gate）**改变这些概率幅与相位。入门时记住四种操作即可：');
  assert.match(html, /<strong>量子门（quantum gate）<\/strong>改变/);
});
