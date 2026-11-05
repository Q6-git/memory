import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../www/scheduler.js';

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

test('알림 계획: 가까운 카드는 묶고, 방해 금지 시간은 피하고, 개수를 제한한다', () => {
  const now = new Date(2026, 0, 1, 12, 0).getTime();
  const at = (h, m = 0, d = 1) => new Date(2026, 0, d, h, m).getTime();
  const card = (front, due) => ({ front, due });
  const plan = S.planNotifications(
    [card('a', at(13)), card('b', at(13, 5)), card('c', at(15)), card('d', at(2, 0, 2)), card('late', at(11))],
    { now, quietStart: 23, quietEnd: 8 },
  );
  // 이미 지난 카드(late)는 1분 뒤, a+b는 하나로 묶임, d는 다음날 8시로 미뤄짐
  assert.equal(plan.length, 4);
  assert.equal(plan[0].at, now + S.MINUTE);
  assert.equal(plan[1].at, at(13, 5));
  assert.equal(plan[1].count, 3);
  assert.match(plan[1].body, /“a” 외 2개/);
  assert.equal(plan[3].at, at(8, 0, 2));
  assert.equal(plan[3].count, 5);
  assert.deepEqual(plan.map((p) => p.id), [1, 2, 3, 4]);

  const many = Array.from({ length: 200 }, (_, i) => card(String(i), now + (i + 1) * S.HOUR));
  assert.equal(S.planNotifications(many, { now, limit: 60 }).length, 60);
});
