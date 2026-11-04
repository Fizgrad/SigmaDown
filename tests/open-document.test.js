import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDocumentSafely } from '../src/open-document.js';

function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }

test('edits made during a slow file read are not discarded when confirmation is cancelled', async () => {
  const read = deferred(); let text = 'original', shown = false, prompts = 0;
  const state = {};
  const pending = openDocumentSafely({ load: () => read.promise, getState: () => state, getText: () => text, isCurrent: () => true, confirmDiscard: async () => { prompts++; return false; }, show: () => { shown = true; } });
  text = 'new unsaved edits'; read.resolve({ content: 'new file' });
  assert.equal(await pending, 'cancelled'); assert.equal(prompts, 1); assert.equal(shown, false); assert.equal(text, 'new unsaved edits');
});

test('edits made while confirming are also retained', async () => {
  const prompt = deferred(); let text = 'before', shown = false;
  const state = {};
  const read = deferred();
  const pending = openDocumentSafely({ load: () => read.promise, getState: () => state, getText: () => text, isCurrent: () => true, confirmDiscard: () => prompt.promise, show: () => { shown = true; } });
  text = 'edited'; read.resolve({ content: 'new' }); await Promise.resolve();
  text = 'edited again'; prompt.resolve(true);
  assert.equal(await pending, 'changed-again'); assert.equal(shown, false);
});

test('opening a file without concurrent edits replaces the current document', async () => {
  let shown; const state = {};
  const result = await openDocumentSafely({ load: async () => ({ content: 'new' }), getState: () => state, getText: () => 'old', isCurrent: () => true, confirmDiscard: () => assert.fail('unexpected confirmation'), show: doc => { shown = doc.content; } });
  assert.equal(result, 'opened'); assert.equal(shown, 'new');
});
