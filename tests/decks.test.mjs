import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as D from '../www/decks.js';

const NOW = new Date(2026, 0, 10, 12, 0).getTime();
const mk = (id, kind, n) =>
  D.indexDeck({ id, kind, title: id, items: Array.from({ length: n }, (_, i) => ({ id: `${id}-${i}`, en: `w${i}`, ko: `뜻${i}` })) });
const decksOf = (...ds) => new Map(ds.map((d) => [d.id, d]));
const learned = (deck, ...idx) => idx.map((i) => ({ deck, ref: `${deck}-${i}`, due: NOW + 1e9 }));

test('켠 덱이 없으면 새 카드 없음', () => {
  const q = D.newQueue({ decks: decksOf(mk('a', 'word', 5)), enabled: {}, cards: [], daily: null, newPerDay: 10, dueCount: 0, now: NOW });
  assert.equal(q.reason, 'no-decks');
  assert.equal(q.items.length, 0);
});

test('하루 개수만큼, 켠 덱끼리 번갈아, 안 배운 것만 순서대로', () => {
  const decks = decksOf(mk('w', 'word', 20), mk('s', 'sentence', 20));
  const q = D.newQueue({
    decks, enabled: { w: true, s: true }, cards: learned('w', 0, 1), daily: null, newPerDay: 6, dueCount: 0, now: NOW,
  });
  assert.equal(q.reason, 'ok');
  assert.deepEqual(q.items.map((x) => x.item.id), ['w-2', 's-0', 'w-3', 's-1', 'w-4', 's-2']);
});

test('한쪽 덱이 먼저 끝나면 남은 덱에서 채운다', () => {
  const decks = decksOf(mk('w', 'word', 1), mk('s', 'sentence', 10));
  const q = D.newQueue({ decks, enabled: { w: true, s: true }, cards: [], daily: null, newPerDay: 5, dueCount: 0, now: NOW });
  assert.deepEqual(q.items.map((x) => x.item.id), ['w-0', 's-0', 's-1', 's-2', 's-3']);
});

test('오늘 배운 수와 더 배우기를 반영하고, 날짜가 바뀌면 초기화', () => {
  const decks = decksOf(mk('w', 'word', 50));
  const base = { decks, enabled: { w: true }, cards: [], newPerDay: 10, dueCount: 0, now: NOW };
  const today = D.todayKey(NOW);
  assert.equal(D.newQueue({ ...base, daily: { date: today, introduced: 10, extra: 0 } }).reason, 'quota');
  assert.equal(D.newQueue({ ...base, daily: { date: today, introduced: 10, extra: 5 } }).items.length, 5);
  assert.equal(D.newQueue({ ...base, daily: { date: '2026-01-09', introduced: 10, extra: 0 } }).items.length, 10);
});

test('밀린 복습이 50개를 넘으면 새 카드를 멈춘다', () => {
  const base = { decks: decksOf(mk('w', 'word', 5)), enabled: { w: true }, cards: [], daily: null, newPerDay: 10, now: NOW };
  assert.equal(D.newQueue({ ...base, dueCount: 50 }).reason, 'ok');
  assert.equal(D.newQueue({ ...base, dueCount: 51 }).reason, 'backlog');
});

test('덱을 다 배우면 finished', () => {
  const q = D.newQueue({
    decks: decksOf(mk('w', 'word', 2)), enabled: { w: true }, cards: learned('w', 0, 1), daily: null, newPerDay: 10, dueCount: 0, now: NOW,
  });
  assert.equal(q.reason, 'finished');
});

test('카드 내용은 덱에서 찾고, 덱에서 사라지면 missing', () => {
  const decks = decksOf(mk('w', 'word', 2));
  assert.equal(D.resolve({ deck: 'w', ref: 'w-1' }, decks).en, 'w1');
  assert.equal(D.frontText({ deck: 'w', ref: 'w-1' }, decks), 'w1');
  assert.equal(D.resolve({ deck: 'w', ref: 'gone' }, decks).kind, 'missing');
  assert.equal(D.resolve({ deck: D.MY_DECK, front: 'q', back: 'a' }, decks).kind, 'custom');
});

test('발음: 단어는 앞면, 문장은 정답, 직접 만든 카드는 영어가 있을 때만', () => {
  assert.deepEqual(D.speechFor({ kind: 'word', en: 'suggest', ex: 'I suggest…' }), { front: 'suggest', back: 'I suggest…' });
  assert.deepEqual(D.speechFor({ kind: 'sentence', ko: '안녕', en: 'Hi' }), { front: null, back: 'Hi' });
  assert.deepEqual(D.speechFor({ kind: 'custom', front: 'ephemeral', back: '덧없는' }), { front: 'ephemeral', back: null });
});

test('기본 덱 파일: 개수, 필수 칸, id 중복 없음', () => {
  const index = JSON.parse(readFileSync(new URL('../www/decks/index.json', import.meta.url)));
  const expected = { 'en-words-beginner': 500, 'en-sentences-beginner': 100 };
  for (const f of index) {
    const deck = JSON.parse(readFileSync(new URL(`../www/decks/${f}`, import.meta.url)));
    assert.equal(deck.items.length, expected[deck.id], deck.id);
    assert.equal(new Set(deck.items.map((it) => it.id)).size, deck.items.length);
    const need = deck.kind === 'word' ? ['en', 'pos', 'ko', 'ex', 'exKo'] : ['situation', 'ko', 'en', 'key'];
    for (const it of deck.items) for (const k of need) assert.ok(it[k], `${deck.id}/${it.id}: ${k}`);
    assert.ok(deck.license && deck.source);
  }
});

test('한 장씩 배워도 덱이 번갈아 나온다 (오늘 덜 꺼낸 덱 먼저)', () => {
  const decks = decksOf(mk('w', 'word', 20), mk('s', 'sentence', 20));
  const base = { decks, enabled: { w: true, s: true }, daily: null, newPerDay: 10, dueCount: 0, now: NOW };
  const today = (deck, i) => ({ deck, ref: `${deck}-${i}`, due: NOW + 1e9, created: NOW - 1000 });
  assert.equal(D.newQueue({ ...base, cards: [] }).items[0].deck.id, 'w');
  assert.equal(D.newQueue({ ...base, cards: [today('w', 0)] }).items[0].deck.id, 's');
  assert.equal(D.newQueue({ ...base, cards: [today('w', 0), today('s', 0)] }).items[0].deck.id, 'w');
});

test('스테이지: 20장 단위, 별 계산, 앞 스테이지를 다 배워야 다음이 열린다', () => {
  const DAY = 86400000;
  const deck = mk('w', 'word', 45);
  assert.equal(D.stageCount(deck), 3);
  assert.equal(D.stageIndexOf(deck, 'w-20'), 1);

  const card = (i, interval, extra = {}) => ({ deck: 'w', ref: `w-${i}`, lastReview: NOW, due: NOW + interval, ...extra });
  let st = D.stages(deck, []);
  assert.deepEqual(st.map((s) => [s.stars, s.unlocked, s.started]), [[0, true, false], [0, false, false], [0, false, false]]);

  // 1스테이지: 19장 배움 + 1장 이미 알아요 → ★, 2스테이지 열림
  const cards = [...Array.from({ length: 19 }, (_, i) => card(i, 60e3)), { deck: 'w', ref: 'w-19', known: true }];
  st = D.stages(deck, cards);
  assert.equal(st[0].stars, 1);
  assert.equal(st[1].unlocked, true);
  assert.equal(st[2].unlocked, false);

  // 모두 간격 1일 이상 → ★★, 7일 이상 → ★★★ (알아요는 ★★★로 침)
  const long = (d) => [...Array.from({ length: 19 }, (_, i) => card(i, d)), { deck: 'w', ref: 'w-19', known: true }];
  assert.equal(D.stages(deck, long(DAY))[0].stars, 2);
  assert.equal(D.stages(deck, long(7 * DAY))[0].stars, 3);
  assert.equal(D.itemStatus({ known: true }), 'known');
  assert.equal(D.itemStatus(undefined), 'new');
});

test('"이미 알아요"는 오늘 번갈아 배분 계산에 넣지 않는다', () => {
  const decks = decksOf(mk('w', 'word', 20), mk('s', 'sentence', 20));
  const known = Array.from({ length: 5 }, (_, i) => ({ deck: 'w', ref: `w-${i}`, known: true, created: NOW - 1000 }));
  const q = D.newQueue({ decks, enabled: { w: true, s: true }, cards: known, daily: null, newPerDay: 4, dueCount: 0, now: NOW });
  assert.deepEqual(q.items.map((x) => x.item.id), ['w-5', 's-0', 'w-6', 's-1']);
});
