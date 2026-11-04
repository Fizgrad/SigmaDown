import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHeadingIds, detectLineEnding, serializeText } from '../src/document-format.js';

test('editing a CRLF document preserves its line endings', () => {
  const original = '# 标题\r\n\r\noriginal\r\n';
  assert.equal(detectLineEnding(original), '\r\n');
  assert.equal(serializeText('# 标题\n\nchanged\n', detectLineEnding(original)), '# 标题\r\n\r\nchanged\r\n');
  assert.equal(serializeText('one\ntwo\n', detectLineEnding('one\ntwo\n')), 'one\ntwo\n');
});

test('headings generate GitHub-compatible fragment IDs including duplicates', () => {
  assert.deepEqual(createHeadingIds(['Section', 'Hello, World!', '标题 介绍', 'Section']), ['section', 'hello-world', '标题-介绍', 'section-1']);
});
