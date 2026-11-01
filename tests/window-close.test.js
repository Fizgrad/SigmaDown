import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCloseHandler } from '../src/window-close.js';

function event() { return { prevented: false, preventDefault() { this.prevented = true; } }; }

test('clean documents let Tauri close the window without a prompt', async () => {
  const close = createCloseHandler({ needsConfirmation: () => false, confirmDiscard: () => assert.fail(), destroy: () => assert.fail() });
  const request = event(); await close(request);
  assert.equal(request.prevented, false);
});

test('unsaved changes can cancel or confirm closing', async () => {
  let approved = false, destroyed = 0;
  const close = createCloseHandler({ needsConfirmation: () => true, confirmDiscard: async () => approved, destroy: async () => { destroyed++; }, reportError: assert.fail });
  const cancelled = event(); await close(cancelled);
  assert.equal(cancelled.prevented, true); assert.equal(destroyed, 0);
  approved = true;
  const confirmed = event(); await close(confirmed);
  assert.equal(confirmed.prevented, true); assert.equal(destroyed, 1);
});

test('repeated close requests do not bypass an open confirmation', async () => {
  let resolve, destroyed = 0;
  const close = createCloseHandler({ needsConfirmation: () => true, confirmDiscard: () => new Promise(r => { resolve = r; }), destroy: async () => { destroyed++; }, reportError: assert.fail });
  const first = event(), second = event();
  const pending = close(first); await close(second);
  assert.equal(first.prevented, true); assert.equal(second.prevented, true);
  resolve(false); await pending;
  assert.equal(destroyed, 0);
});

test('failed window destruction is reported and can be retried', async () => {
  let reports = 0;
  const close = createCloseHandler({ needsConfirmation: () => true, confirmDiscard: async () => true, destroy: async () => { throw Error('denied'); }, reportError: () => { reports++; } });
  await close(event()); await close(event());
  assert.equal(reports, 2);
});

test('window permissions allow both requesting and completing close', async () => {
  const { readFile } = await import('node:fs/promises');
  const capability = JSON.parse(await readFile(new URL('../src-tauri/capabilities/default.json', import.meta.url), 'utf8'));
  assert.ok(capability.permissions.includes('core:window:allow-close'));
  assert.ok(capability.permissions.includes('core:window:allow-destroy'));
});
