import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// 안드로이드 네이티브 브리지에는 registerPlugin이 없으므로, 앱은 vendor/capacitor-core.js에 의존한다.
// 설치된 @capacitor/core와 다르면 `node scripts/vendor.mjs`를 다시 실행해야 한다.
test('vendor/capacitor-core.js가 설치된 @capacitor/core와 같다', () => {
  const vendored = readFileSync(new URL('../www/vendor/capacitor-core.js', import.meta.url), 'utf8');
  const installed = readFileSync(new URL('../node_modules/@capacitor/core/dist/index.js', import.meta.url), 'utf8');
  assert.equal(vendored, installed);
  assert.match(vendored, /export \{[^}]*registerPlugin/);
});

test('앱 코드는 window.Capacitor.registerPlugin을 직접 쓰지 않는다', () => {
  for (const f of ['native.js', 'tts.js', 'app.js']) {
    const src = readFileSync(new URL(`../www/${f}`, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /window\.Capacitor|Cap\.registerPlugin/, f);
  }
});
