import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Marked } from 'marked';
import { createMathExtensions } from '../src/markdown-math.js';

function parse(source) {
  const formulas = [];
  const marked = new Marked({ extensions: createMathExtensions((tex, display) => {
    formulas.push({ tex, display });
    return '<span class="math-slot"></span>';
  }) });
  return { html: marked.parse(source), formulas };
}

test('inline formulas preserve escaped dollar signs and consume the closing delimiter', () => {
  const { html, formulas } = parse(String.raw`Price: $\text{cost \$5 and \$10}$ after.`);
  assert.deepEqual(formulas, [{ tex: String.raw`\text{cost \$5 and \$10}`, display: false }]);
  assert.equal(html, '<p>Price: <span class="math-slot"></span> after.</p>\n');
});

test('an even number of backslashes allows a dollar sign to close a formula', () => {
  const { html, formulas } = parse(String.raw`Math $x\\$ after.`);
  assert.deepEqual(formulas, [{ tex: String.raw`x\\`, display: false }]);
  assert.equal(html, '<p>Math <span class="math-slot"></span> after.</p>\n');
});

test('an odd number of backslashes escapes a dollar sign within a formula', () => {
  const { formulas } = parse(String.raw`Math $x\\\$y$ after.`);
  assert.deepEqual(formulas, [{ tex: String.raw`x\\\$y`, display: false }]);
});

test('basic inline and display delimiters remain supported', () => {
  const { formulas } = parse(String.raw`Inline $x^2$ and \(a+b\).

$$\frac{1}{2}$$

\[c=d\]`);
  assert.deepEqual(formulas, [
    { tex: String.raw`\frac{1}{2}`, display: true },
    { tex: 'c=d', display: true },
    { tex: 'x^2', display: false },
    { tex: 'a+b', display: false }
  ]);
});

test('code spans and fenced code never create formula slots', () => {
  const { html, formulas } = parse('`$literal$`\n\n```text\n$$not math$$\n```');
  assert.deepEqual(formulas, []);
  assert.ok(html.includes('<code>$literal$</code>'));
  assert.ok(html.includes('$$not math$$'));
});

test('an unmatched or escaped opening dollar remains ordinary Markdown', () => {
  const { formulas } = parse(String.raw`Price \$5; unfinished $x and \$y.`);
  assert.deepEqual(formulas, []);
});
