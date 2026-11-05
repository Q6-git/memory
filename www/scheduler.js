// 망각 곡선 기반 복습 스케줄러 (UI와 무관한 순수 로직)
//
// 모델: 에빙하우스 망각 곡선 R(t) = exp(-t / S)
//   - R: 기억 유지 확률 (retention), t: 마지막 복습 후 경과 시간, S: 기억 안정성(stability)
//   - 다음 복습 시점은 R이 목표 유지율(targetRetention, 기본 90%)까지 떨어지는 순간:
//       t* = -S · ln(targetRetention)
//   - 복습에 성공할 때마다 S가 커져 곡선이 완만해지고, 간격이 점점 길어진다 (간격 반복 효과).
//   - 기억이 많이 흐려졌을 때(R이 낮을 때) 떠올리는 데 성공하면 S가 더 크게 늘어난다 (spacing effect).
//
// 기본값(첫 간격 20분, '알맞음' 성장 배수 3)이면 간격은 20분 → 1시간 → 3시간 → 9시간 → 1.1일 → 3.4일 → 10일 → 1개월…
// 이렇게 늘어나서, 에빙하우스 실험의 측정 시점(20분, 1시간, 9시간, 1일, 6일, 31일)과 대략 맞는다.

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

export const GRADES = ['again', 'hard', 'good', 'easy'];

export const DEFAULT_CONFIG = {
  targetRetention: 0.9,
  firstIntervalMin: 20,
  growth: { hard: 1.4, good: 3, easy: 5 },
  lapseFactor: 0.3,
};

export function withDefaults(cfg = {}) {
  return { ...DEFAULT_CONFIG, ...cfg, growth: { ...DEFAULT_CONFIG.growth, ...(cfg.growth || {}) } };
}

/** 경과 시간(ms)과 안정성(ms)으로 현재 기억 유지 확률 */
export function retention(elapsedMs, stabilityMs) {
  if (elapsedMs <= 0) return 1;
  return Math.exp(-elapsedMs / stabilityMs);
}

/** 안정성 S에서 유지율이 target까지 떨어지는 데 걸리는 시간(ms) */
export function intervalFor(stabilityMs, targetRetention) {
  return -stabilityMs * Math.log(targetRetention);
}

/** 첫 복습이 firstIntervalMin 뒤에 오도록 하는 초기 안정성 */
export function initialStability(cfg) {
  const c = withDefaults(cfg);
  return (c.firstIntervalMin * MINUTE) / -Math.log(c.targetRetention);
}

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

export function newCard({ front, back, now = Date.now(), cfg, id }) {
  const c = withDefaults(cfg);
  const s = initialStability(c);
  return {
    id: id ?? `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    front,
    back,
    created: now,
    lastReview: now,
    stability: s,
    due: now + intervalFor(s, c.targetRetention),
    reps: 0,
    lapses: 0,
    history: [{ t: now, grade: 'learn', s }],
  };
}

/** 지금 이 카드를 기억하고 있을 확률 */
export function currentRetention(card, now = Date.now()) {
  return retention(now - card.lastReview, card.stability);
}

/** 평가 결과로 바뀔 새 안정성 계산 */
export function nextStability(card, grade, now, cfg) {
  const c = withDefaults(cfg);
  const s0 = initialStability(c);
  if (grade === 'again') {
    return Math.max(s0, card.stability * c.lapseFactor);
  }
  const base = c.growth[grade];
  if (!base) throw new Error(`unknown grade: ${grade}`);
  // 예정대로 복습하면 spacing = 1, 너무 일찍 하면 성장 폭이 작고, 늦게 해서 성공하면 더 크다.
  const r = currentRetention(card, now);
  const spacing = clamp((1 - r) / (1 - c.targetRetention), 0.2, 2);
  return card.stability * (1 + (base - 1) * spacing);
}

/** 복습 결과를 반영한 새 카드 (원본은 바꾸지 않음) */
export function review(card, grade, now = Date.now(), cfg) {
  const c = withDefaults(cfg);
  const s = nextStability(card, grade, now, c);
  return {
    ...card,
    stability: s,
    lastReview: now,
    due: now + intervalFor(s, c.targetRetention),
    reps: card.reps + 1,
    lapses: card.lapses + (grade === 'again' ? 1 : 0),
    history: [...card.history, { t: now, grade, s }],
  };
}

/** 각 평가 버튼을 눌렀을 때의 다음 간격(ms) 미리보기 */
export function previewIntervals(card, now = Date.now(), cfg) {
  const c = withDefaults(cfg);
  return Object.fromEntries(
    GRADES.map((g) => [g, intervalFor(nextStability(card, g, now, c), c.targetRetention)]),
  );
}

export function dueCards(cards, now = Date.now()) {
  return cards.filter((c) => c.due <= now).sort((a, b) => a.due - b.due);
}

/** 사람이 읽기 좋은 기간 표기 */
export function formatDuration(ms) {
  const abs = Math.abs(ms);
  if (abs < MINUTE) return '1분 미만';
  if (abs < HOUR) return `${Math.round(abs / MINUTE)}분`;
  if (abs < DAY) return `${Math.round(abs / HOUR)}시간`;
  if (abs < 30 * DAY) return `${+(abs / DAY).toFixed(abs < 3 * DAY ? 1 : 0)}일`;
  if (abs < 365 * DAY) return `${+(abs / (30 * DAY)).toFixed(1)}개월`;
  return `${+(abs / (365 * DAY)).toFixed(1)}년`;
}

/** 방해 금지 시간(시 단위, 예: 23시~8시) 안이면 끝나는 시각으로 미룬다 */
export function deferForQuietHours(ts, quietStart, quietEnd) {
  if (quietStart == null || quietEnd == null || quietStart === quietEnd) return ts;
  const d = new Date(ts);
  const h = d.getHours() + d.getMinutes() / 60;
  const inQuiet = quietStart < quietEnd ? h >= quietStart && h < quietEnd : h >= quietStart || h < quietEnd;
  if (!inQuiet) return ts;
  const end = new Date(d);
  end.setHours(quietEnd, 0, 0, 0);
  if (end.getTime() <= ts) end.setDate(end.getDate() + 1);
  return end.getTime();
}

/**
 * 앞으로 보낼 알림 목록을 미리 계획한다 (네이티브 로컬 알림 예약용).
 * - 각 카드의 복습 시각을 방해 금지 시간 밖으로 미루고
 * - windowMs 안에 몰린 카드는 알림 하나로 묶고
 * - OS 예약 개수 제한(iOS 64개)을 넘지 않도록 앞에서부터 limit개만 남긴다.
 * 알림 본문의 개수는 "그 시각까지 복습 안 하고 쌓인 카드 수"다. 복습하면 앱이 계획을 다시 세운다.
 */
export function planNotifications(cards, { now = Date.now(), quietStart, quietEnd, windowMs = 10 * MINUTE, limit = 60 } = {}) {
  const items = cards
    .map((c) => ({ card: c, at: deferForQuietHours(Math.max(c.due, now + MINUTE), quietStart, quietEnd) }))
    .sort((a, b) => a.at - b.at);
  const plan = [];
  for (const it of items) {
    const last = plan[plan.length - 1];
    if (last && it.at - last.firstAt <= windowMs) {
      last.at = it.at; // 묶음의 마지막 카드까지 복습할 때가 됐을 때 알린다
      last.fronts.push(it.card.front);
    } else {
      if (plan.length >= limit) break;
      plan.push({ firstAt: it.at, at: it.at, fronts: [it.card.front] });
    }
  }
  let pending = 0;
  return plan.map((p, i) => {
    pending += p.fronts.length;
    return {
      id: i + 1,
      at: p.at,
      title: '복습할 시간이에요',
      body: `“${p.fronts[0]}”${pending > 1 ? ` 외 ${pending - 1}개` : ''} — 잊기 전에 떠올려 보세요.`,
      count: pending,
    };
  });
}
