import * as S from './scheduler.js';
import * as D from './decks.js';
import { curveSVG } from './curve.js';
import * as Native from './native.js';
import * as TTS from './tts.js';

const STORE_KEY = 'doesaegim:v1';
const DEFAULT_SETTINGS = {
  targetRetention: 0.9,
  firstIntervalMin: 20,
  notify: false,
  quietStart: 23,
  quietEnd: 8,
  newPerDay: 10,
  ttsAuto: true,
  ttsSlow: false,
};

// ---------- 상태 ----------
let state = load();
let decks = new Map(); // id → 덱 (decks/*.json)
let view = location.hash.slice(1) || 'review';
let revealed = false;
let selectedId = null;
let cardFilter = 'all';
let lastSpoken = '';
let ready = false; // 덱을 불러오기 전에는 그리지 않는다 (덱 카드 내용이 아직 없으므로)

function load() {
  const empty = { cards: [], settings: { ...DEFAULT_SETTINGS }, decks: {}, daily: null };
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return empty;
    const s = JSON.parse(raw);
    return {
      ...empty,
      ...s,
      // 덱 기능 이전에 만든 카드는 "내 카드" 덱으로
      cards: (s.cards || []).map((c) => (c.deck ? c : { ...c, deck: D.MY_DECK })),
      settings: { ...DEFAULT_SETTINGS, ...s.settings },
      decks: s.decks || {},
    };
  } catch (e) {
    console.warn('저장된 데이터를 읽지 못했습니다', e);
    return empty;
  }
}

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch (e) {
    alert('저장에 실패했습니다: ' + e.message);
  }
  syncReminders();
  render();
}

async function loadDecks() {
  try {
    const list = await (await fetch('decks/index.json')).json();
    const loaded = await Promise.all(list.map(async (f) => D.indexDeck(await (await fetch('decks/' + f)).json())));
    decks = new Map(loaded.map((d) => [d.id, d]));
  } catch (e) {
    console.warn('덱을 불러오지 못했습니다', e);
  }
}

const cfg = () => ({ targetRetention: state.settings.targetRetention, firstIntervalMin: state.settings.firstIntervalMin });
const enabled = () => Object.fromEntries(Object.entries(state.decks).map(([id, v]) => [id, !!v.enabled]));

function queue(now = Date.now()) {
  const due = S.dueCards(state.cards, now);
  const fresh = D.newQueue({
    decks, enabled: enabled(), cards: state.cards, daily: state.daily,
    newPerDay: state.settings.newPerDay, dueCount: due.length, now,
  });
  return { due, fresh };
}

// ---------- 유틸 ----------
const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const pct = (r) => `${Math.round(r * 100)}%`;
const GRADE_LABEL = { again: '다시', hard: '어려움', good: '알맞음', easy: '쉬움' };
const speakBtn = (text) => (TTS.supported && text ? `<button class="speak" data-speak="${esc(text)}" aria-label="발음 듣기">🔊</button>` : '');

// 예문에서 단어/핵심 표현을 강조. 활용형(works, looking)과 사이에 낀 목적어(think it over)도 찾는다.
function highlight(en, key) {
  if (!key) return esc(en);
  let i = en.toLowerCase().indexOf(key.toLowerCase());
  let len = key.length;
  if (i < 0) {
    const stem = (t) => t.slice(0, Math.max(3, t.length - 1)).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "[\\w']*";
    const re = new RegExp('\\b' + key.toLowerCase().split(/\s+/).map(stem).join("\\s+(?:[\\w']+\\s+)?"), 'i');
    const m = re.exec(en);
    if (!m) return esc(en);
    i = m.index;
    len = m[0].length;
  }
  return esc(en.slice(0, i)) + '<mark>' + esc(en.slice(i, i + len)) + '</mark>' + esc(en.slice(i + len));
}

// 카드 앞면/뒷면 HTML
function faceHTML(r, side) {
  if (r.kind === 'word') {
    return side === 'front'
      ? `<div class="front" lang="en">${esc(r.en)} ${speakBtn(r.en)}</div><div class="sub">${esc(r.pos)}</div>`
      : `<div class="back">${esc(r.ko)}</div>
         ${r.ex ? `<div class="ex"><span lang="en">${highlight(r.ex, r.en)}</span> ${speakBtn(r.ex)}</div><div class="ex-ko">${esc(r.exKo)}</div>` : ''}`;
  }
  if (r.kind === 'sentence') {
    return side === 'front'
      ? `<div class="tag">${esc(r.situation)}</div><div class="front sentence">${esc(r.ko)}</div>`
      : `<div class="back" lang="en">${highlight(r.en, r.key)} ${speakBtn(r.en)}</div>
         ${r.key ? `<div class="ex-ko">핵심 표현 <b lang="en">${esc(r.key)}</b>${r.note ? ` · ${esc(r.note)}` : ''}</div>` : ''}`;
  }
  const sp = D.speechFor(r);
  return side === 'front'
    ? `<div class="front">${esc(r.front)} ${speakBtn(sp.front)}</div>`
    : `<div class="back">${esc(r.back)} ${speakBtn(sp.back)}</div>`;
}

// ---------- 화면 ----------
function render() {
  if (!ready) return;
  renderHeader();
  const now = Date.now();
  const app = $('#app');
  const views = { review: renderReview, decks: renderDecks, cards: renderCards, stats: renderStats, settings: renderSettings };
  app.innerHTML = (views[view] || renderReview)(now);
  bind(app);
  autoSpeak();
}

function renderHeader() {
  if (!ready) return;
  document.querySelectorAll('.tabs button').forEach((b) => b.setAttribute('aria-selected', b.dataset.view === view));
  const { due, fresh } = queue();
  const pill = $('#due-pill');
  pill.hidden = !due.length && !fresh.items.length;
  pill.textContent = [due.length && `복습 ${due.length}`, fresh.items.length && `새 카드 ${fresh.items.length}`].filter(Boolean).join(' · ');
  document.title = due.length ? `(${due.length}) 되새김` : '되새김';
  if ('setAppBadge' in navigator) {
    (due.length ? navigator.setAppBadge(due.length) : navigator.clearAppBadge()).catch(() => {});
  }
}

function renderReview(now) {
  const { due, fresh } = queue(now);
  const meta = `<div class="meta"><span>복습 ${due.length} · 새 카드 ${fresh.items.length}</span>${
    fresh.reason === 'backlog' ? '<span class="warn-text">밀린 복습이 많아 새 카드는 쉬어요</span>' : ''}`;

  if (due.length) {
    const card = due[0];
    const r = D.resolve(card, decks);
    const preview = S.previewIntervals(card, now, cfg());
    return `<section class="review">
      ${meta}<span>기억 확률 약 ${pct(S.currentRetention(card, now))}</span></div>
      <div class="flash">${faceHTML(r, 'front')}${revealed ? `<hr>${faceHTML(r, 'back')}` : ''}</div>
      ${revealed
        ? `<div class="grades">${S.GRADES.map((g) => `
            <button class="grade ${g}" data-grade="${g}" data-id="${card.id}">
              <span>${GRADE_LABEL[g]}</span><small>${S.formatDuration(preview[g])}</small>
            </button>`).join('')}</div>
           <p class="hint muted">${r.kind === 'sentence'
             ? '정답과 똑같지 않아도, 뜻이 통하고 핵심 표현을 썼으면 “알맞음”이에요.'
             : '스스로 떠올린 정도를 골라주세요. 버튼 아래는 다음 복습까지의 간격이에요.'} (단축키 1–4)</p>`
        : `<p class="hint muted">${r.kind === 'sentence' ? '영어로 소리 내어 말해 본 뒤' : '뜻을 떠올려 본 뒤'} 정답을 확인하세요.</p>
           <button class="primary wide" data-reveal>정답 보기 <small>(Space)</small></button>`}
    </section>`;
  }

  if (fresh.items.length) {
    const { deck, item } = fresh.items[0];
    const r = { kind: deck.kind, deck, ...item };
    return `<section class="review">
      ${meta}<span class="new-badge">새 카드 · ${esc(deck.title)}</span></div>
      <div class="flash intro">${faceHTML(r, 'front')}<hr>${faceHTML(r, 'back')}</div>
      <p class="hint muted">${r.kind === 'sentence' ? '영어 문장을 들으며 두세 번 따라 말해 보세요.' : '발음을 듣고 예문까지 소리 내어 읽어 보세요.'}</p>
      <button class="primary wide" data-learn="${deck.id}:${item.id}">외웠어요 <small>(Space)</small></button>
      <p class="hint muted">${state.settings.firstIntervalMin}분 뒤에 첫 복습을 알려드려요.</p>
    </section>`;
  }

  if (!state.cards.length && fresh.reason === 'no-decks') {
    return `<section class="empty">
      <p>무엇을 외워 볼까요?</p>
      <p class="muted">기본 제공 덱을 켜면 하루 ${state.settings.newPerDay}개씩 새 카드가 나오고,<br>잊어버리기 직전에 복습하라고 알려드려요.</p>
      <button class="primary" data-go="decks">덱 고르기</button>
    </section>`;
  }

  const next = [...state.cards].sort((a, b) => a.due - b.due)[0];
  const msg = {
    quota: `오늘의 새 카드를 다 배웠어요 🎉`,
    finished: '켠 덱의 카드를 모두 배웠어요 🎉',
    'no-decks': '지금 복습할 카드가 없어요 🎉',
  }[fresh.reason] || '지금 복습할 카드가 없어요 🎉';
  return `<section class="empty">
    <p>${msg}</p>
    ${next ? `<p class="muted">다음 복습은 <b>${S.formatDuration(next.due - now)} 후</b> · “${esc(D.frontText(next, decks))}”</p>` : ''}
    ${fresh.reason === 'quota' ? `<button data-more>오늘 ${D.EXTRA_STEP}개 더 배우기</button>` : ''}
    ${state.settings.notify ? '' : '<button data-go="settings">복습 알림 켜기</button>'}
  </section>`;
}

function renderDecks() {
  const d = D.dailyFor(state.daily);
  const deckRows = [...decks.values()].map((deck) => {
    const p = D.deckProgress(deck, state.cards);
    const on = !!state.decks[deck.id]?.enabled;
    return `<div class="deck ${on ? 'on' : ''}">
      <div class="deck-head">
        <div><b>${esc(deck.title)}</b><small class="muted">${esc(deck.description || '')}</small></div>
        <label class="switch"><input type="checkbox" data-deck="${deck.id}" ${on ? 'checked' : ''}> 학습</label>
      </div>
      <div class="bar wide-bar"><i style="width:${(p.learned / Math.max(1, p.total)) * 100}%"></i></div>
      <small class="muted">${p.learned} / ${p.total} 배움</small>
    </div>`;
  }).join('');

  const mine = state.cards.filter((c) => c.deck === D.MY_DECK).length;
  return `<section class="stack">
    <p class="muted">오늘 새로 배운 카드 ${d.introduced} / ${state.settings.newPerDay + d.extra}개 · 켠 덱끼리 번갈아 나와요.</p>
    ${deckRows || '<p class="muted">기본 덱을 불러오지 못했어요.</p>'}

    <h2>내 카드 <small class="muted">${mine}장</small></h2>
    <form id="add-form" class="stack">
      <label>앞면 (질문)<textarea name="front" rows="2" required placeholder="예: ephemeral"></textarea></label>
      <label>뒷면 (정답)<textarea name="back" rows="2" required placeholder="예: 덧없는, 순식간의"></textarea></label>
      <button class="primary">카드 추가</button>
      <p class="muted">직접 만든 카드는 추가하는 순간이 첫 학습이에요. ${state.settings.firstIntervalMin}분 뒤에 첫 복습을 알려드려요.</p>
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
  if (!state.cards.length) return `<section class="empty"><p>아직 배운 카드가 없어요.</p></section>`;
  const options = [['all', '전체'], ...[...decks.values()].map((d) => [d.id, d.title]), [D.MY_DECK, '내 카드']]
    .map(([v, l]) => `<option value="${v}" ${v === cardFilter ? 'selected' : ''}>${esc(l)}</option>`).join('');
  const rows = state.cards
    .filter((c) => cardFilter === 'all' || c.deck === cardFilter)
    .sort((a, b) => a.due - b.due)
    .map((c) => {
      const r = S.currentRetention(c, now);
      const when = c.due <= now ? '<b class="due-now">지금</b>' : `${S.formatDuration(c.due - now)} 후`;
      return `<li><button class="row" data-open="${c.id}">
        <span class="title">${esc(D.frontText(c, decks))}</span>
        <span class="bar" title="현재 기억 확률 ${pct(r)}"><i style="width:${r * 100}%"></i></span>
        <span class="when">${when}</span>
      </button></li>`;
    }).join('');
  return `<section class="stack"><select id="card-filter">${options}</select><ul class="list">${rows || '<p class="muted">이 덱에서 배운 카드가 없어요.</p>'}</ul></section>`;
}

function renderCardDetail(card, now) {
  const r = D.resolve(card, decks);
  const isDeck = card.deck !== D.MY_DECK;
  return `<section class="stack">
    <button class="link" data-back>← 목록</button>
    <div class="flash small">${faceHTML(r, 'front')}<hr>${faceHTML(r, 'back')}</div>
    <div class="facts">
      <div><small>지금 기억 확률</small><b>${pct(S.currentRetention(card, now))}</b></div>
      <div><small>다음 복습</small><b>${card.due <= now ? '지금' : S.formatDuration(card.due - now) + ' 후'}</b></div>
      <div><small>기억 안정성</small><b>${S.formatDuration(card.stability)}</b></div>
      <div><small>복습 / 잊음</small><b>${card.reps} / ${card.lapses}</b></div>
    </div>
    <figure>${curveSVG(card, now, state.settings.targetRetention)}
      <figcaption class="muted">복습할 때마다 기억이 100%로 회복되고, 곡선이 점점 완만해져요. (가로축은 로그 시간)</figcaption></figure>
    <button class="danger" data-delete="${card.id}">${isDeck ? '학습 기록 지우기 (새 카드로 되돌리기)' : '카드 삭제'}</button>
  </section>`;
}

function renderStats(now) {
  const cards = state.cards;
  const avg = cards.length ? cards.reduce((s, c) => s + S.currentRetention(c, now), 0) / cards.length : 0;
  const dayStart = new Date(now).setHours(0, 0, 0, 0);
  const reviewsToday = cards.reduce((s, c) => s + c.history.filter((h) => h.grade !== 'learn' && h.t >= dayStart).length, 0);
  const days = Array.from({ length: 7 }, (_, i) => {
    const start = dayStart + i * S.DAY, end = start + S.DAY;
    return { label: i === 0 ? '오늘' : new Date(start).toLocaleDateString('ko', { weekday: 'short' }),
      n: cards.filter((c) => (i === 0 ? c.due < end : c.due >= start && c.due < end)).length };
  });
  const max = Math.max(1, ...days.map((d) => d.n));
  return `<section class="stack">
    <div class="facts">
      <div><small>배운 카드</small><b>${cards.length}</b></div>
      <div><small>지금 복습</small><b>${S.dueCards(cards, now).length}</b></div>
      <div><small>오늘 복습함</small><b>${reviewsToday}</b></div>
      <div><small>평균 기억 확률</small><b>${cards.length ? pct(avg) : '–'}</b></div>
    </div>
    <h2>앞으로 7일 복습 예정</h2>
    <div class="forecast">${days.map((d) => `<div><span class="n">${d.n}</span><i style="height:${(d.n / max) * 100}%"></i><small>${d.label}</small></div>`).join('')}</div>
    <h2>어떻게 동작하나요?</h2>
    <p class="muted">기억은 시간이 지나며 <code>R = e<sup>−t/S</sup></code> 곡선을 따라 흐려져요(에빙하우스 망각 곡선).
      되새김은 카드마다 기억 안정성 <code>S</code>를 추적해서, 기억 확률이 목표치(${pct(state.settings.targetRetention)})까지 떨어지는 순간에 복습을 알려줘요.
      잘 떠올릴수록 <code>S</code>가 커져서 간격이 20분 → 1시간 → 3시간 → 9시간 → 1일 → 3일 → 10일 → 한 달…로 늘어나요.</p>
  </section>`;
}

function renderSettings() {
  const st = state.settings;
  const perm = Native.isNative ? nativePerm : 'Notification' in window ? Notification.permission : 'unsupported';
  const hours = (sel) => Array.from({ length: 24 }, (_, h) => `<option value="${h}" ${h === sel ? 'selected' : ''}>${h}시</option>`).join('');
  const sources = [...decks.values()].map((d) => `<li><b>${esc(d.title)}</b> — ${esc(d.source || '')} <small>(${esc(d.license || '')})</small></li>`).join('');
  return `<section class="stack">
    <h2>학습</h2>
    <label>하루 새 카드
      <select id="newPerDay">${[5, 10, 15, 20].map((v) => `<option value="${v}" ${v === st.newPerDay ? 'selected' : ''}>${v}개${v === 10 ? ' (권장)' : ''}</option>`).join('')}</select></label>
    <p class="muted">복습이 ${D.BACKLOG_LIMIT}개 넘게 밀리면 그날은 새 카드를 쉬어요.</p>
    ${TTS.supported
      ? `<label class="switch"><input type="checkbox" id="ttsAuto" ${st.ttsAuto ? 'checked' : ''}> 영어가 보이면 자동으로 읽어 주기</label>
         <label class="switch"><input type="checkbox" id="ttsSlow" ${st.ttsSlow ? 'checked' : ''}> 느리게 읽기</label>`
      : '<p class="muted">이 기기는 음성 읽기를 지원하지 않아요.</p>'}

    <h2>알림</h2>
    ${perm === 'unsupported'
      ? '<p class="muted">이 브라우저는 알림을 지원하지 않아요.</p>'
      : `<label class="switch"><input type="checkbox" id="notify" ${st.notify && perm === 'granted' ? 'checked' : ''}> 복습할 때가 되면 알림 받기</label>
         ${perm === 'denied' ? `<p class="warn">${Native.isNative ? '알림이 꺼져 있어요. 휴대폰 설정 → 앱 → 되새김 → 알림에서 허용해 주세요.' : '브라우저에서 알림이 차단되어 있어요. 사이트 설정에서 허용해 주세요.'}</p>` : ''}
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
    <p class="muted">학습 기록은 이 기기에만 저장돼요. 다른 기기로 옮기려면 내보내기/가져오기를 쓰세요.</p>
    <div class="row2">
      <button id="export">내보내기 (JSON)</button>
      <label class="button">가져오기<input id="import" type="file" accept="application/json" hidden></label>
    </div>
    <button class="danger" id="reset">모든 데이터 삭제</button>

    <h2>덱 출처 및 라이선스</h2>
    <ul class="sources muted">${sources}</ul>
  </section>`;
}

// ---------- 발음 ----------
function autoSpeak() {
  if (!TTS.supported || !state.settings.ttsAuto || view !== 'review') return;
  const { due, fresh } = queue();
  let key = '', text = null;
  if (due.length) {
    const sp = D.speechFor(D.resolve(due[0], decks));
    key = `${due[0].id}:${revealed ? 'back' : 'front'}:${due[0].reps}`;
    // 단어는 앞면에서 단어를, 문장은 정답에서 영어 문장을 읽는다
    text = revealed ? (sp.front ? null : sp.back) : sp.front;
  } else if (fresh.items.length) {
    const { deck, item } = fresh.items[0];
    key = `new:${deck.id}:${item.id}`;
    text = deck.kind === 'word' ? item.en : item.en;
  }
  if (key === lastSpoken) return;
  lastSpoken = key;
  if (text) TTS.speak(text, { slow: state.settings.ttsSlow });
}

// ---------- 이벤트 ----------
function bind(root) {
  root.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));
  root.querySelector('[data-reveal]')?.addEventListener('click', reveal);
  root.querySelector('[data-learn]')?.addEventListener('click', (e) => learn(e.currentTarget.dataset.learn));
  root.querySelector('[data-more]')?.addEventListener('click', () => {
    const d = D.dailyFor(state.daily);
    state.daily = { ...d, extra: d.extra + D.EXTRA_STEP };
    save();
  });
  root.querySelectorAll('[data-speak]').forEach((b) =>
    b.addEventListener('click', (e) => { e.stopPropagation(); TTS.speak(b.dataset.speak, { slow: state.settings.ttsSlow }); }));
  root.querySelectorAll('[data-grade]').forEach((b) => b.addEventListener('click', () => grade(b.dataset.id, b.dataset.grade)));
  root.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => { selectedId = b.dataset.open; render(); }));
  root.querySelector('[data-back]')?.addEventListener('click', () => { selectedId = null; render(); });
  root.querySelector('#card-filter')?.addEventListener('change', (e) => { cardFilter = e.target.value; render(); });
  root.querySelector('[data-delete]')?.addEventListener('click', (e) => {
    const card = state.cards.find((c) => c.id === e.currentTarget.dataset.delete);
    const isDeck = card?.deck !== D.MY_DECK;
    if (!confirm(isDeck ? '학습 기록을 지우고 새 카드로 되돌릴까요?' : '이 카드를 삭제할까요?')) return;
    state.cards = state.cards.filter((c) => c !== card);
    selectedId = null;
    save();
  });
  root.querySelectorAll('[data-deck]').forEach((b) => b.addEventListener('change', (e) => {
    state.decks[b.dataset.deck] = { ...state.decks[b.dataset.deck], enabled: e.target.checked };
    save();
  }));

  root.querySelector('#add-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    addCards([[f.get('front'), f.get('back')]]);
    toast('추가했어요');
    $('#add-form textarea')?.focus();
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
      const p = Native.isNative ? (nativePerm = await Native.requestPermission()) : await Notification.requestPermission();
      state.settings.notify = p === 'granted';
      if (p === 'granted' && !Native.isNative) registerPeriodicSync();
    } else {
      state.settings.notify = false;
    }
    save();
  });
  root.querySelector('#test-notify')?.addEventListener('click', () =>
    Native.isNative ? Native.testNotification() : notify('테스트 알림', '이렇게 복습 시간을 알려드려요.'));
  for (const id of ['ttsAuto', 'ttsSlow']) {
    root.querySelector('#' + id)?.addEventListener('change', (e) => { state.settings[id] = e.target.checked; save(); });
  }
  for (const id of ['quietStart', 'quietEnd', 'targetRetention', 'firstIntervalMin', 'newPerDay']) {
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
      const refs = new Set(state.cards.map((c) => `${c.deck}:${c.ref}`));
      const fresh = data.cards
        .map((c) => (c.deck ? c : { ...c, deck: D.MY_DECK }))
        .filter((c) => c.id && !ids.has(c.id) && (c.deck === D.MY_DECK || !refs.has(`${c.deck}:${c.ref}`)));
      state.cards.push(...fresh);
      for (const [id, v] of Object.entries(data.decks || {})) state.decks[id] ??= v;
      save();
      toast(`${fresh.length}개 가져왔어요`);
    } catch (err) {
      alert('가져오기 실패: ' + err.message);
    }
  });
  root.querySelector('#reset')?.addEventListener('click', () => {
    if (!confirm('모든 카드와 복습 기록을 삭제할까요? 되돌릴 수 없어요.')) return;
    state = { cards: [], settings: { ...DEFAULT_SETTINGS }, decks: {}, daily: null };
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

function reveal() {
  revealed = true;
  render();
}

function addCards(pairs) {
  const now = Date.now();
  pairs.forEach(([front, back], i) => {
    state.cards.push({ ...S.newCard({ front: String(front).trim(), back: String(back).trim(), now: now + i, cfg: cfg() }), deck: D.MY_DECK });
  });
  save();
}

// 새 카드를 "외웠어요" → 망각 곡선 시작
function learn(key) {
  const [deckId, ref] = key.split(':');
  if (state.cards.some((c) => c.deck === deckId && c.ref === ref)) return;
  const card = S.newCard({ now: Date.now(), cfg: cfg() });
  delete card.front;
  delete card.back;
  state.cards.push({ ...card, deck: deckId, ref });
  const d = D.dailyFor(state.daily);
  state.daily = { ...d, introduced: d.introduced + 1 };
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
  if (e.code === 'Space') {
    const btn = $('[data-reveal]') || $('[data-learn]');
    if (btn) {
      e.preventDefault();
      btn.click();
    }
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
// 네이티브 앱: OS 로컬 알림을 미리 예약 (native.js)
// 웹: 탭이 열려 있으면 30초마다 확인, 닫혀 있으면 서비스 워커의 Periodic Background Sync
const notified = new Set();
const withFronts = () => state.cards.map((c) => ({ ...c, front: D.frontText(c, decks) }));

function syncReminders() {
  const cards = withFronts();
  syncScheduleForWorker(cards);
  Native.syncNotifications(cards, state.settings);
}

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
  if (Native.isNative) return; // OS가 예약된 알림을 띄운다
  const st = state.settings;
  if (!st.notify) return;
  const now = Date.now();
  if (S.deferForQuietHours(now, st.quietStart, st.quietEnd) !== now) return;
  const due = S.dueCards(state.cards, now);
  const fresh = due.filter((c) => !notified.has(c.id + ':' + c.due));
  if (!fresh.length) return;
  fresh.forEach((c) => notified.add(c.id + ':' + c.due));
  if (!document.hidden) return; // 보고 있는 중이면 배지/제목만 갱신
  notify('복습할 시간이에요', `“${D.frontText(fresh[0], decks)}”${due.length > 1 ? ` 외 ${due.length - 1}개` : ''} — 잊기 전에 떠올려 보세요.`);
}

// 서비스 워커는 localStorage를 못 읽으므로, 복습 예정 시각만 Cache Storage에 적어 둔다.
async function syncScheduleForWorker(cards) {
  if (Native.isNative || !('caches' in window)) return;
  try {
    const st = state.settings;
    const body = JSON.stringify({
      notify: st.notify, quietStart: st.quietStart, quietEnd: st.quietEnd,
      cards: cards.map((c) => ({ due: c.due, front: c.front })),
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

let nativePerm = 'default';
if (Native.isNative) {
  Native.permission().then((p) => {
    nativePerm = p;
    if (view === 'settings') render();
  });
  Native.onNotificationTap((v) => go(v));
} else if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').then(() => state.settings.notify && registerPeriodicSync()).catch(console.warn);
}

setInterval(checkDue, 30_000);
document.addEventListener('visibilitychange', checkDue);
window.addEventListener('hashchange', () => go(location.hash.slice(1) || 'review'));

loadDecks().then(() => {
  ready = true;
  syncReminders();
  render();
});
