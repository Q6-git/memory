// 카드 한 장의 망각 곡선(톱니 모양)을 SVG로 그린다.
import { retention, MINUTE, HOUR, DAY, formatDuration } from './scheduler.js';

const W = 640;
const H = 220;
const PAD = { l: 40, r: 14, t: 14, b: 30 };
const GRADE_COLOR = {
  learn: 'var(--accent)',
  again: 'var(--again)',
  hard: 'var(--hard)',
  good: 'var(--good)',
  easy: 'var(--easy)',
};

export function curveSVG(card, now, targetRetention) {
  const t0 = card.created;
  const span = Math.max(now, card.due) - t0;
  const tEnd = t0 + Math.max(span * 1.25, 30 * MINUTE);

  // 시간축은 로그 스케일: 몇 분짜리 첫 간격과 몇 달짜리 간격을 한 화면에 담기 위해
  const unit = 5 * MINUTE;
  const fx = (t) => Math.log1p(Math.max(0, t - t0) / unit);
  const xMax = fx(tEnd);
  const x = (t) => PAD.l + (fx(t) / xMax) * (W - PAD.l - PAD.r);
  const y = (r) => PAD.t + (1 - r) * (H - PAD.t - PAD.b);

  const h = card.history;
  let d = '';
  h.forEach((ev, i) => {
    const segEnd = i + 1 < h.length ? h[i + 1].t : tEnd;
    const n = 48;
    for (let k = 0; k <= n; k++) {
      // 로그축에서 고르게 보이도록 샘플링
      const a = fx(ev.t), b = fx(segEnd);
      const xt = t0 + unit * Math.expm1(a + ((b - a) * k) / n);
      const r = retention(xt - ev.t, ev.s);
      d += `${d ? 'L' : 'M'}${x(xt).toFixed(1)},${y(r).toFixed(1)}`;
    }
  });

  const ticks = [
    [10 * MINUTE, '10분'], [HOUR, '1시간'], [6 * HOUR, '6시간'], [DAY, '1일'],
    [7 * DAY, '1주'], [30 * DAY, '1달'], [90 * DAY, '3달'], [365 * DAY, '1년'],
  ].filter(([ms]) => t0 + ms < tEnd);

  const grid = [1, 0.75, 0.5, 0.25]
    .map((r) => `<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${y(r)}" y2="${y(r)}" class="grid"/>
      <text x="${PAD.l - 6}" y="${y(r) + 4}" text-anchor="end" class="axis">${r * 100}%</text>`)
    .join('');

  const xTicks = ticks
    .map(([ms, label]) => `<line x1="${x(t0 + ms)}" x2="${x(t0 + ms)}" y1="${PAD.t}" y2="${H - PAD.b}" class="grid"/>
      <text x="${x(t0 + ms)}" y="${H - PAD.b + 16}" text-anchor="middle" class="axis">${label}</text>`)
    .join('');

  const dots = h
    .map((ev) => `<circle cx="${x(ev.t)}" cy="${y(1)}" r="4.5" fill="${GRADE_COLOR[ev.grade]}"><title>${new Date(ev.t).toLocaleString()} · ${ev.grade}</title></circle>`)
    .join('');

  const nowX = x(Math.min(now, tEnd));
  const dueX = x(card.due);

  return `<svg viewBox="0 0 ${W} ${H}" class="curve" role="img" aria-label="이 카드의 망각 곡선">
    ${grid}${xTicks}
    <line x1="${PAD.l}" x2="${W - PAD.r}" y1="${y(targetRetention)}" y2="${y(targetRetention)}" class="target"/>
    <text x="${W - PAD.r}" y="${y(targetRetention) - 5}" text-anchor="end" class="axis">목표 ${Math.round(targetRetention * 100)}%</text>
    <path d="${d}" class="line"/>
    <line x1="${nowX}" x2="${nowX}" y1="${PAD.t}" y2="${H - PAD.b}" class="now"/>
    <text x="${nowX + 4}" y="${H - PAD.b - 6}" class="axis">지금</text>
    <circle cx="${dueX}" cy="${y(targetRetention)}" r="5" class="due"><title>다음 복습: ${formatDuration(card.due - now)} ${card.due > now ? '후' : '지남'}</title></circle>
    ${dots}
  </svg>`;
}
