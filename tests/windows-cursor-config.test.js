import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Windows WebView keeps the pointer visible while preserving Wry defaults', async () => {
  const config = JSON.parse(await readFile(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
  const args = config.app.windows[0].additionalBrowserArgs;
  const features = args.match(/(?:^|\s)--disable-features=([^\s]+)/)?.[1].split(',') ?? [];
  assert.match(args, /(?:^|\s)--autoplay-policy=no-user-gesture-required(?:\s|$)/);
  for (const feature of ['HideCursorWhileTyping', 'msWebOOUI', 'msPdfOOUI', 'msSmartScreenProtection']) {
    assert.ok(features.includes(feature), `missing disabled WebView2 feature: ${feature}`);
  }
});
