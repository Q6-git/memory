import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../scheduler.js';

const T0 = new Date('2026-01-01T09:00:00').getTime();
const near = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} !≈ ${b}`);

test('새 카드의 첫 복습은 firstIntervalMin 뒤', () => {
  const c = S.newCard({ front: 'a', back: 'b', now: T0 });
  near(c.due - T0, 20 * S.MINUTE, 1);
  // 예정 시각에는 기억 확률이 정확히 목표치
  near(S.currentRetention(c, c.due), 0.9, 1e-9);
});

test('제때 "알맞음"을 누르면 간격이 에빙하우스 측정 시점과 비슷하게 늘어난다', () => {
  let c = S.newCard({ front: 'a', back: 'b', now: T0 });
  const intervals = [];
  for (let i = 0; i < 7; i++) {
    c = S.review(c, 'good', c.due);
    intervals.push(c.due - c.lastReview);
  }
  near(intervals[0], 1 * S.HOUR, S.MINUTE);
  near(intervals[2], 9 * S.HOUR, S.MINUTE);
  near(intervals[3], 27 * S.HOUR, S.MINUTE);
  assert.ok(intervals[6] > 25 * S.DAY && intervals[6] < 35 * S.DAY);
  for (let i = 1; i < intervals.length; i++) assert.ok(intervals[i] > intervals[i - 1]);
});

test('평가가 좋을수록 다음 간격이 길다', () => {
  const c = S.review(S.newCard({ front: 'a', back: 'b', now: T0 }), 'good', T0 + 20 * S.MINUTE);
  const p = S.previewIntervals(c, c.due);
  assert.ok(p.again < p.hard && p.hard < p.good && p.good < p.easy);
});

test('"다시"는 안정성을 줄이지만 초기값 아래로는 내리지 않는다', () => {
  let c = S.newCard({ front: 'a', back: 'b', now: T0 });
  for (let i = 0; i < 5; i++) c = S.review(c, 'good', c.due);
  const before = c.stability;
  c = S.review(c, 'again', c.due);
  assert.ok(c.stability < before);
  assert.equal(c.lapses, 1);
  const fresh = S.review(S.newCard({ front: 'a', back: 'b', now: T0 }), 'again', T0 + 1);
  near(fresh.stability, S.initialStability(), 1e-6);
});

test('너무 일찍 복습하면 효과가 작고, 늦게 성공하면 효과가 크다 (spacing effect)', () => {
  const c = S.review(S.newCard({ front: 'a', back: 'b', now: T0 }), 'good', T0 + 20 * S.MINUTE);
  const early = S.nextStability(c, 'good', c.lastReview + 1);
  const onTime = S.nextStability(c, 'good', c.due);
  const late = S.nextStability(c, 'good', c.due + 3 * S.HOUR);
  assert.ok(early < onTime && onTime < late);
});

test('목표 기억 확률을 높이면 복습이 더 자주 온다', () => {
  const lo = S.newCard({ front: 'a', back: 'b', now: T0, cfg: { targetRetention: 0.8 } });
  const hi = S.newCard({ front: 'a', back: 'b', now: T0, cfg: { targetRetention: 0.95 } });
  // 첫 간격은 둘 다 firstIntervalMin, 그 다음부터 차이가 난다
  const lo2 = S.review(lo, 'good', lo.due, { targetRetention: 0.8 });
  const hi2 = S.review(hi, 'good', hi.due, { targetRetention: 0.95 });
  assert.ok(hi2.due - hi2.lastReview <= lo2.due - lo2.lastReview);
});

test('review는 원본 카드를 바꾸지 않는다', () => {
  const c = S.newCard({ front: 'a', back: 'b', now: T0 });
  const copy = structuredClone(c);
  S.review(c, 'easy', c.due);
  assert.deepEqual(c, copy);
});

test('방해 금지 시간', () => {
  const at = (h, m = 0) => new Date(2026, 0, 1, h, m).getTime();
  assert.equal(S.deferForQuietHours(at(15), 23, 8), at(15));
  assert.equal(S.deferForQuietHours(at(23, 30), 23, 8), new Date(2026, 0, 2, 8).getTime());
  assert.equal(S.deferForQuietHours(at(3), 23, 8), at(8));
  assert.equal(S.deferForQuietHours(at(13), 12, 14), at(14));
});

test('formatDuration', () => {
  assert.equal(S.formatDuration(20 * S.MINUTE), '20분');
  assert.equal(S.formatDuration(9 * S.HOUR), '9시간');
  assert.equal(S.formatDuration(1.5 * S.DAY), '1.5일');
  assert.equal(S.formatDuration(10 * S.DAY), '10일');
  assert.equal(S.formatDuration(60 * S.DAY), '2개월');
});
