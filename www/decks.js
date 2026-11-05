// 덱(기본 제공 콘텐츠)과 하루 신규 카드 배분 로직. UI 의존성 없음 (테스트 대상).
//
// 덱 카드의 내용(단어 뜻, 예문 등)은 덱 파일에만 있고, 사용자 데이터에는 deck/ref와 학습 기록만 저장한다.
// 그래서 덱 내용을 고쳐 배포해도 복습 기록은 그대로 유지된다.

export const MY_DECK = 'mine';
export const BACKLOG_LIMIT = 50; // 밀린 복습이 이보다 많으면 그날 새 카드를 멈춘다
export const EXTRA_STEP = 5; // "오늘 N개 더 배우기"

export function indexDeck(deck) {
  return { ...deck, byId: new Map(deck.items.map((it) => [it.id, it])) };
}

/** 카드 한 장을 화면에 보여 줄 내용으로 바꾼다 */
export function resolve(card, decks) {
  if (!card.deck || card.deck === MY_DECK) return { kind: 'custom', front: card.front, back: card.back };
  const deck = decks.get(card.deck);
  const item = deck?.byId.get(card.ref);
  if (!item) return { kind: 'missing', front: card.front || '(덱에서 사라진 카드)', back: '' };
  return { kind: deck.kind, deck, ...item };
}

/** 알림, 목록 등 한 줄로 보여 줄 때의 앞면 텍스트 */
export function frontText(card, decks) {
  const r = resolve(card, decks);
  if (r.kind === 'word') return r.en;
  if (r.kind === 'sentence') return r.ko;
  return r.front;
}

/** 소리 내어 읽을 영어: { front, back } (해당 면에 영어가 없으면 null) */
export function speechFor(r) {
  if (r.kind === 'word') return { front: r.en, back: r.ex || null };
  if (r.kind === 'sentence') return { front: null, back: r.en };
  const latin = (s) => (s && /[A-Za-z]{2,}/.test(s) ? s : null);
  return { front: latin(r.front), back: latin(r.back) };
}

export function todayKey(now = Date.now()) {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 날짜가 바뀌었으면 오늘 카운터를 초기화한 값을 돌려준다 */
export function dailyFor(daily, now = Date.now()) {
  const date = todayKey(now);
  return daily?.date === date ? daily : { date, introduced: 0, extra: 0 };
}

export function deckProgress(deck, cards) {
  const learned = new Set(cards.filter((c) => c.deck === deck.id).map((c) => c.ref));
  return { learned: deck.items.filter((it) => learned.has(it.id)).length, total: deck.items.length };
}

/**
 * 오늘 새로 배울 카드 목록.
 * - 켠 덱들 사이에서 번갈아 가며, 각 덱의 순서(빈도순)대로 아직 안 배운 항목을 꺼낸다.
 * - 오늘 남은 개수 = 하루 개수 + 더 배우기 - 오늘 이미 배운 수
 * - 밀린 복습이 BACKLOG_LIMIT를 넘으면 멈춘다.
 * 반환: { items: [{deck, item}], reason: 'ok' | 'backlog' | 'quota' | 'finished' | 'no-decks', left }
 */
export function newQueue({ decks, enabled, cards, daily, newPerDay, dueCount, now = Date.now() }) {
  const active = [...decks.values()].filter((d) => enabled[d.id]);
  if (!active.length) return { items: [], reason: 'no-decks', left: 0 };

  const learned = new Set(cards.filter((c) => c.deck && c.deck !== MY_DECK).map((c) => `${c.deck}:${c.ref}`));
  // 오늘 덜 꺼낸 덱부터: 한 장씩 배울 때마다 목록이 다시 계산되므로, 이렇게 해야 덱이 번갈아 나온다
  const dayStart = new Date(now).setHours(0, 0, 0, 0);
  const todayCount = (id) => cards.filter((c) => c.deck === id && c.created >= dayStart).length;
  const pools = active
    .map((d, order) => ({ deck: d, order, today: todayCount(d.id), rest: d.items.filter((it) => !learned.has(`${d.id}:${it.id}`)) }))
    .sort((a, b) => a.today - b.today || a.order - b.order);
  const left = pools.reduce((n, p) => n + p.rest.length, 0);
  if (!left) return { items: [], reason: 'finished', left };
  if (dueCount > BACKLOG_LIMIT) return { items: [], reason: 'backlog', left };

  const d = dailyFor(daily, now);
  const quota = Math.max(0, newPerDay + d.extra - d.introduced);
  if (!quota) return { items: [], reason: 'quota', left };

  const items = [];
  for (let i = 0; items.length < quota; i++) {
    let took = false;
    for (const p of pools) {
      if (items.length >= quota) break;
      if (i < p.rest.length) {
        items.push({ deck: p.deck, item: p.rest[i] });
        took = true;
      }
    }
    if (!took) break;
  }
  return { items, reason: 'ok', left };
}
