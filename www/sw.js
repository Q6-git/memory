// 서비스 워커: 오프라인 캐시 + 앱이 닫혀 있을 때의 복습 알림
const SHELL_CACHE = 'doesaegim-shell-v5';
const META_CACHE = 'doesaegim-meta';
const SHELL = ['./', './index.html', './styles.css', './app.js', './scheduler.js', './curve.js', './native.js', './decks.js', './tts.js', './decks/index.json', './manifest.webmanifest', './icon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('doesaegim-shell-') && k !== SHELL_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// 네트워크 우선, 실패하면 캐시 (오프라인에서도 열리도록)
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(SHELL_CACHE).then((c) => c.put(req, copy));
        return res;
      })
      .catch(() => caches.match(req).then((r) => r || caches.match('./index.html'))),
  );
});

// 설치된 PWA(Chrome/Edge)에서 브라우저가 주기적으로 깨워 줄 때
self.addEventListener('periodicsync', (e) => {
  if (e.tag === 'due-check') e.waitUntil(checkDue());
});

function inQuiet(ts, start, end) {
  if (start == null || end == null || start === end) return false;
  const d = new Date(ts);
  const h = d.getHours() + d.getMinutes() / 60;
  return start < end ? h >= start && h < end : h >= start || h < end;
}

async function checkDue() {
  const meta = await caches.open(META_CACHE);
  const res = await meta.match('schedule.json');
  if (!res) return;
  const sched = await res.json();
  const now = Date.now();
  if (!sched.notify || inQuiet(now, sched.quietStart, sched.quietEnd)) return;

  // 앱이 열려 있으면 앱 쪽에서 처리한다
  const open = await self.clients.matchAll({ type: 'window' });
  if (open.some((c) => c.visibilityState === 'visible')) return;

  const lastRes = await meta.match('last-check');
  const last = lastRes ? Number(await lastRes.text()) : 0;
  const due = sched.cards.filter((c) => c.due <= now);
  const fresh = due.filter((c) => c.due > last);
  await meta.put('last-check', new Response(String(now)));
  if (!fresh.length) return;

  await self.registration.showNotification('복습할 시간이에요', {
    body: `“${fresh[0].front}”${due.length > 1 ? ` 외 ${due.length - 1}개` : ''} — 잊기 전에 떠올려 보세요.`,
    tag: 'due',
    icon: 'icon.svg',
    badge: 'icon.svg',
    data: { url: './#review' },
  });
}

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || './', self.registration.scope).href;
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const win = list.find((c) => c.url.startsWith(self.registration.scope));
      if (win) return win.focus().then((w) => w.navigate?.(url));
      return self.clients.openWindow(url);
    }),
  );
});
