import * as S from './scheduler.js';
import { curveSVG } from './curve.js';

const STORE_KEY = 'doesaegim:v1';
const DEFAULT_SETTINGS = {
  targetRetention: 0.9,
  firstIntervalMin: 20,
  notify: false,
  quietStart: 23,
  quietEnd: 8,
};

// ---------- 상태 ----------
let state = load();
let view = location.hash.slice(1) || 'review';
let revealed = false;
let selectedId = null;

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      return { cards: s.cards || [], settings: { ...DEFAULT_SETTINGS, ...s.settings } };
    }
  } catch (e) {
    console.warn('저장된 데이터를 읽지 못했습니다', e);
  }
  return { cards: [], settings: { ...DEFAULT_SETTINGS } };
}

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch (e) {
    alert('저장에 실패했습니다: ' + e.message);
  }
  syncScheduleForWorker();
  render();
}

const cfg = () => ({
  targetRetention: state.settings.targetRetention,
  firstIntervalMin: state.settings.firstIntervalMin,
});

// ---------- 유틸 ----------
const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const pct = (r) => `${Math.round(r * 100)}%`;
const GRADE_LABEL = { again: '다시', hard: '어려움', good: '알맞음', easy: '쉬움' };

// ---------- 화면 ----------
function render() {
  renderHeader();
  const now = Date.now();
  const due = S.dueCards(state.cards, now);
  const app = $('#app');
  const views = { review: renderReview, add: renderAdd, cards: renderCards, stats: renderStats, settings: renderSettings };
  app.innerHTML = (views[view] || renderReview)(now, due);
  bind(app);
}

function renderHeader() {
  document.querySelectorAll('.tabs button').forEach((b) => {
    b.setAttribute('aria-selected', b.dataset.view === view);
  });
  const now = Date.now();
  const due = S.dueCards(state.cards, now);
  const pill = $('#due-pill');
  pill.hidden = due.length === 0;
  pill.textContent = `복습 ${due.length}`;
  document.title = due.length ? `(${due.length}) 되새김` : '되새김';
  if ('setAppBadge' in navigator) {
    (due.length ? navigator.setAppBadge(due.length) : navigator.clearAppBadge()).catch(() => {});
  }
}

function renderReview(now, due) {
  if (state.cards.length === 0) {
    return `<section class="empty">
      <p>아직 카드가 없어요.</p>
      <p class="muted">외우고 싶은 걸 카드로 추가하면, 잊어버리기 직전에 복습하라고 알려드려요.</p>
      <button class="primary" data-go="add">첫 카드 만들기</button>
    </section>`;
  }
  if (due.length === 0) {
    const next = [...state.cards].sort((a, b) => a.due - b.due)[0];
    return `<section class="empty">
      <p>지금 복습할 카드가 없어요 🎉</p>
      <p class="muted">다음 복습은 <b>${S.formatDuration(next.due - now)} 후</b> · “${esc(next.front)}”</p>
      ${state.settings.notify ? '' : '<button data-go="settings">복습 알림 켜기</button>'}
    </section>`;
  }
  const card = due[0];
  const r = S.currentRetention(card, now);
  const preview = S.previewIntervals(card, now, cfg());
  return `<section class="review">
    <div class="meta"><span>남은 카드 ${due.length}</span><span>지금 기억 확률 약 ${pct(r)}</span></div>
    <div class="flash">
      <div class="front">${esc(card.front)}</div>
      ${revealed ? `<hr><div class="back">${esc(card.back)}</div>` : ''}
    </div>
    ${revealed
      ? `<div class="grades">${S.GRADES.map((g) => `
          <button class="grade ${g}" data-grade="${g}" data-id="${card.id}">
            <span>${GRADE_LABEL[g]}</span><small>${S.formatDuration(preview[g])}</small>
          </button>`).join('')}</div>
         <p class="hint muted">스스로 떠올린 정도를 골라주세요. 버튼 아래는 다음 복습까지의 간격이에요. (단축키 1–4)</p>`
      : `<button class="primary wide" data-reveal>정답 보기 <small class="muted">(Space)</small></button>`}
  </section>`;
}

function renderAdd() {
  return `<section>
    <form id="add-form" class="stack">
      <label>앞면 (질문)<textarea name="front" rows="3" required placeholder="예: ephemeral"></textarea></label>
      <label>뒷면 (정답)<textarea name="back" rows="3" required placeholder="예: 덧없는, 순식간의"></textarea></label>
      <button class="primary">카드 추가</button>
      <p class="muted">추가하는 순간이 첫 학습이에요. 첫 복습은 ${state.settings.firstIntervalMin}분 뒤에 알려드려요.</p>
    </form>
    <details class="bulk">
      <summary>여러 개 한 번에 추가</summary>
      <form id="bulk-form" class="stack">
        <label>한 줄에 하나씩, <code>앞면 | 뒷면</code> 또는 탭으로 구분
          <textarea name="bulk" rows="6" placeholder="apple | 사과&#10;banana | 바나나"></textarea></label>
        <button>모두 추가</button>
      </form>
    </details>
  </section>`;
}

function renderCards(now) {
  if (selectedId) {
    const card = state.cards.find((c) => c.id === selectedId);
    if (card) return renderCardDetail(card, now);
    selectedId = null;
  }
  if (!state.cards.length) return `<section class="empty"><p>카드가 없어요.</p></section>`;
  const rows = [...state.cards]
    .sort((a, b) => a.due - b.due)
    .map((c) => {
      const r = S.currentRetention(c, now);
      const when = c.due <= now ? '<b class="due-now">지금</b>' : `${S.formatDuration(c.due - now)} 후`;
      return `<li><button class="row" data-open="${c.id}">
        <span class="title">${esc(c.front)}</span>
        <span class="bar" title="현재 기억 확률 ${pct(r)}"><i style="width:${r * 100}%"></i></span>
        <span class="when">${when}</span>
      </button></li>`;
    })
    .join('');
  return `<section><ul class="list">${rows}</ul></section>`;
}

function renderCardDetail(card, now) {
  const r = S.currentRetention(card, now);
  return `<section class="stack">
    <button class="link" data-back>← 목록</button>
    <div class="flash small"><div class="front">${esc(card.front)}</div><hr><div class="back">${esc(card.back)}</div></div>
    <div class="facts">
      <div><small>지금 기억 확률</small><b>${pct(r)}</b></div>
      <div><small>다음 복습</small><b>${card.due <= now ? '지금' : S.formatDuration(card.due - now) + ' 후'}</b></div>
      <div><small>기억 안정성</small><b>${S.formatDuration(card.stability)}</b></div>
      <div><small>복습 / 잊음</small><b>${card.reps} / ${card.lapses}</b></div>
    </div>
    <figure>${curveSVG(card, now, state.settings.targetRetention)}
      <figcaption class="muted">복습할 때마다 기억이 100%로 회복되고, 곡선이 점점 완만해져요. (가로축은 로그 시간)</figcaption></figure>
    <button class="danger" data-delete="${card.id}">카드 삭제</button>
  </section>`;
}

function renderStats(now) {
  const cards = state.cards;
  const avg = cards.length ? cards.reduce((s, c) => s + S.currentRetention(c, now), 0) / cards.length : 0;
  const dayStart = new Date(now).setHours(0, 0, 0, 0);
  const reviewsToday = cards.reduce((s, c) => s + c.history.filter((h) => h.grade !== 'learn' && h.t >= dayStart).length, 0);

  // 앞으로 7일 복습 예정 수
  const days = Array.from({ length: 7 }, (_, i) => {
    const start = dayStart + i * S.DAY, end = start + S.DAY;
    return { label: i === 0 ? '오늘' : new Date(start).toLocaleDateString('ko', { weekday: 'short' }),
      n: cards.filter((c) => (i === 0 ? c.due < end : c.due >= start && c.due < end)).length };
  });
  const max = Math.max(1, ...days.map((d) => d.n));

  return `<section class="stack">
    <div class="facts">
      <div><small>전체 카드</small><b>${cards.length}</b></div>
      <div><small>지금 복습</small><b>${S.dueCards(cards, now).length}</b></div>
      <div><small>오늘 복습함</small><b>${reviewsToday}</b></div>
      <div><small>평균 기억 확률</small><b>${cards.length ? pct(avg) : '–'}</b></div>
    </div>
    <h2>앞으로 7일</h2>
    <div class="forecast">${days.map((d) => `<div><span class="n">${d.n}</span><i style="height:${(d.n / max) * 100}%"></i><small>${d.label}</small></div>`).join('')}</div>
    <h2>어떻게 동작하나요?</h2>
    <p class="muted">기억은 시간이 지나며 <code>R = e<sup>−t/S</sup></code> 곡선을 따라 흐려져요(에빙하우스 망각 곡선).
      되새김은 카드마다 기억 안정성 <code>S</code>를 추적해서, 기억 확률이 목표치(${pct(state.settings.targetRetention)})까지 떨어지는 순간에 복습을 알려줘요.
      잘 떠올릴수록 <code>S</code>가 커져서 간격이 20분 → 1시간 → 3시간 → 9시간 → 1일 → 3일 → 10일 → 한 달…로 늘어나요.</p>
  </section>`;
}

function renderSettings() {
  const st = state.settings;
  const perm = 'Notification' in window ? Notification.permission : 'unsupported';
  const hours = (sel) => Array.from({ length: 24 }, (_, h) => `<option value="${h}" ${h === sel ? 'selected' : ''}>${h}시</option>`).join('');
  return `<section class="stack">
    <h2>알림</h2>
    ${perm === 'unsupported'
      ? '<p class="muted">이 브라우저는 알림을 지원하지 않아요.</p>'
      : `<label class="switch"><input type="checkbox" id="notify" ${st.notify && perm === 'granted' ? 'checked' : ''}> 복습할 때가 되면 알림 받기</label>
         ${perm === 'denied' ? '<p class="warn">브라우저에서 알림이 차단되어 있어요. 사이트 설정에서 허용해 주세요.</p>' : ''}
         <button id="test-notify" ${perm !== 'granted' ? 'disabled' : ''}>테스트 알림 보내기</button>`}
    <div class="row2">
      <label>방해 금지 시작<select id="quietStart">${hours(st.quietStart)}</select></label>
      <label>방해 금지 끝<select id="quietEnd">${hours(st.quietEnd)}</select></label>
    </div>
    <p class="muted">방해 금지 시간에 돌아온 복습은 끝나는 시각에 모아서 알려드려요.</p>

    <h2>복습 간격</h2>
    <label>목표 기억 확률
      <select id="targetRetention">
        ${[0.8, 0.85, 0.9, 0.95].map((v) => `<option value="${v}" ${v === st.targetRetention ? 'selected' : ''}>${v * 100}%${v === 0.9 ? ' (권장)' : ''}</option>`).join('')}
      </select></label>
    <p class="muted">높일수록 더 자주 복습하는 대신 덜 잊어버려요. 바꾸면 이후 복습부터 적용돼요.</p>
    <label>첫 복습까지 (분)<input id="firstIntervalMin" type="number" min="1" max="1440" value="${st.firstIntervalMin}"></label>

    <h2>데이터</h2>
    <p class="muted">카드는 이 기기의 브라우저에만 저장돼요. 다른 기기로 옮기려면 내보내기/가져오기를 쓰세요.</p>
    <div class="row2">
      <button id="export">내보내기 (JSON)</button>
      <label class="button">가져오기<input id="import" type="file" accept="application/json" hidden></label>
    </div>
    <button class="danger" id="reset">모든 데이터 삭제</button>
  </section>`;
}

// ---------- 이벤트 ----------
function bind(root) {
  root.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));
  root.querySelector('[data-reveal]')?.addEventListener('click', () => { revealed = true; render(); });
  root.querySelectorAll('[data-grade]').forEach((b) => b.addEventListener('click', () => grade(b.dataset.id, b.dataset.grade)));
  root.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => { selectedId = b.dataset.open; render(); }));
  root.querySelector('[data-back]')?.addEventListener('click', () => { selectedId = null; render(); });
  root.querySelector('[data-delete]')?.addEventListener('click', (e) => {
    if (!confirm('이 카드를 삭제할까요?')) return;
    state.cards = state.cards.filter((c) => c.id !== e.currentTarget.dataset.delete);
    selectedId = null;
    save();
  });

  root.querySelector('#add-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    addCards([[f.get('front'), f.get('back')]]);
    e.target.reset();
    toast('추가했어요');
    e.target.front.focus();
  });
  root.querySelector('#bulk-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const pairs = String(new FormData(e.target).get('bulk'))
      .split('\n')
      .map((l) => l.split(/\t|\s\|\s|\|/).map((s) => s.trim()))
      .filter(([a, b]) => a && b);
    if (!pairs.length) return toast('형식에 맞는 줄이 없어요');
    addCards(pairs);
    toast(`${pairs.length}개 추가했어요`);
  });

  // 설정
  root.querySelector('#notify')?.addEventListener('change', async (e) => {
    if (e.target.checked) {
      const p = await Notification.requestPermission();
      state.settings.notify = p === 'granted';
      if (p === 'granted') registerPeriodicSync();
    } else {
      state.settings.notify = false;
    }
    save();
  });
  root.querySelector('#test-notify')?.addEventListener('click', () => notify('테스트 알림', '이렇게 복습 시간을 알려드려요.'));
  for (const id of ['quietStart', 'quietEnd', 'targetRetention', 'firstIntervalMin']) {
    root.querySelector('#' + id)?.addEventListener('change', (e) => {
      const v = Number(e.target.value);
      if (!Number.isFinite(v) || (id === 'firstIntervalMin' && v < 1)) return;
      state.settings[id] = v;
      save();
    });
  }
  root.querySelector('#export')?.addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(blob),
      download: `doesaegim-${new Date().toISOString().slice(0, 10)}.json`,
    });
    a.click();
    URL.revokeObjectURL(a.href);
  });
  root.querySelector('#import')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data.cards)) throw new Error('cards 항목이 없어요');
      const ids = new Set(state.cards.map((c) => c.id));
      const fresh = data.cards.filter((c) => c.id && !ids.has(c.id));
      state.cards.push(...fresh);
      save();
      toast(`${fresh.length}개 가져왔어요`);
    } catch (err) {
      alert('가져오기 실패: ' + err.message);
    }
  });
  root.querySelector('#reset')?.addEventListener('click', () => {
    if (!confirm('모든 카드와 복습 기록을 삭제할까요? 되돌릴 수 없어요.')) return;
    state = { cards: [], settings: { ...DEFAULT_SETTINGS } };
    save();
  });
}

function go(v) {
  view = v;
  selectedId = null;
  revealed = false;
  history.replaceState(null, '', '#' + v);
  render();
}

function addCards(pairs) {
  const now = Date.now();
  pairs.forEach(([front, back], i) => {
    state.cards.push(S.newCard({ front: String(front).trim(), back: String(back).trim(), now: now + i, cfg: cfg() }));
  });
  save();
}

function grade(id, g) {
  const i = state.cards.findIndex((c) => c.id === id);
  if (i < 0) return;
  state.cards[i] = S.review(state.cards[i], g, Date.now(), cfg());
  revealed = false;
  save();
}

document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => go(b.dataset.view)));
document.addEventListener('keydown', (e) => {
  if (view !== 'review' || e.target.closest('input, textarea, select')) return;
  if (e.code === 'Space' && !revealed && $('[data-reveal]')) {
    e.preventDefault();
    revealed = true;
    render();
  } else if (revealed && ['1', '2', '3', '4'].includes(e.key)) {
    $(`[data-grade="${S.GRADES[+e.key - 1]}"]`)?.click();
  }
});

function toast(msg) {
  const t = Object.assign(document.createElement('div'), { className: 'toast', textContent: msg });
  document.body.append(t);
  setTimeout(() => t.remove(), 1800);
}

// ---------- 알림 ----------
// 앱(탭)이 열려 있는 동안: 30초마다 확인해서 새로 복습 시간이 된 카드가 있으면 알림.
// 앱이 닫혀 있을 때: 지원 브라우저(설치된 Chrome/Edge PWA)에서는 서비스 워커의 Periodic Background Sync로 확인.
const notified = new Set();

async function notify(title, body) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const opts = { body, tag: 'due', icon: 'icon.svg', badge: 'icon.svg', data: { url: './#review' } };
  const reg = await navigator.serviceWorker?.getRegistration();
  if (reg) reg.showNotification(title, opts);
  else new Notification(title, opts);
}

function checkDue() {
  // 입력 중인 화면을 지우지 않도록, 복습 대기 화면에서만 본문을 다시 그린다
  if (view === 'review' && !revealed) render();
  else renderHeader();
  const st = state.settings;
  if (!st.notify) return;
  const now = Date.now();
  if (S.deferForQuietHours(now, st.quietStart, st.quietEnd) !== now) return;
  const fresh = S.dueCards(state.cards, now).filter((c) => !notified.has(c.id + ':' + c.due));
  if (!fresh.length) return;
  fresh.forEach((c) => notified.add(c.id + ':' + c.due));
  if (!document.hidden) return; // 보고 있는 중이면 배지/제목만 갱신
  const total = S.dueCards(state.cards, now).length;
  notify('복습할 시간이에요', `“${fresh[0].front}”${total > 1 ? ` 외 ${total - 1}개` : ''} — 잊기 전에 떠올려 보세요.`);
}

// 서비스 워커는 localStorage를 못 읽으므로, 복습 예정 시각만 Cache Storage에 적어 둔다.
async function syncScheduleForWorker() {
  if (!('caches' in window)) return;
  try {
    const st = state.settings;
    const body = JSON.stringify({
      notify: st.notify,
      quietStart: st.quietStart,
      quietEnd: st.quietEnd,
      cards: state.cards.map((c) => ({ due: c.due, front: c.front })),
    });
    const cache = await caches.open('doesaegim-meta');
    await cache.put('schedule.json', new Response(body, { headers: { 'content-type': 'application/json' } }));
  } catch {
    /* 캐시를 못 쓰는 환경이면 백그라운드 알림만 빠진다 */
  }
}

async function registerPeriodicSync() {
  try {
    const reg = await navigator.serviceWorker?.ready;
    if (!reg?.periodicSync) return;
    const status = await navigator.permissions.query({ name: 'periodic-background-sync' });
    if (status.state === 'granted') await reg.periodicSync.register('due-check', { minInterval: 15 * S.MINUTE });
  } catch {
    /* 미지원 브라우저 */
  }
}

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').then(() => state.settings.notify && registerPeriodicSync()).catch(console.warn);
}

setInterval(checkDue, 30_000);
document.addEventListener('visibilitychange', checkDue);
window.addEventListener('hashchange', () => go(location.hash.slice(1) || 'review'));
syncScheduleForWorker();
render();
