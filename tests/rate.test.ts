import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CUSTOM_RATES, customRateIndex, formatRate, isPlaybackPage, parseRate, playbackKey, sameRate, videoKey } from '../src/rate.ts';

test('accepts supported rates and trims whitespace', () => {
  for (const value of ['0.25', '0.5', '1', '2.50', '2.75', '3.5', '4', '4.00', '4.01', '6', '9.75', '10', '10.00', ' 2.75 ']) {
    assert.deepEqual(parseRate(value), { ok: true, rate: Number(value) });
  }
});

test('rejects incomplete, excessive, non-finite, and out-of-range values', () => {
  for (const value of ['', ' ', 'abc', '2.75abc', '-1', '0', '0.24', '10.01', '11', 'Infinity',
    'NaN', '1e0', '0x2', '2.755', '2.', '.5', '2,75', '+2', '2.7.5', '9'.repeat(400)]) {
    assert.equal(parseRate(value).ok, false, value);
  }
});

test('formats native and custom speeds without trailing zeros', () => {
  assert.equal(formatRate(2.5), '2.5');
  assert.equal(formatRate(4), '4');
  assert.equal(formatRate(2.75), '2.75');
  assert.equal(sameRate(2.75, 2.750000001), true);
  assert.equal(sameRate(2.75, 2.76), false);
});

test('limits operation to actual video and episode pages', () => {
  for (const path of ['/video/BV1GJ411x7h7/', '/video/av123', '/bangumi/play/ep317925',
    '/bangumi/play/ss123/', '/list/ml12345', '/list/123/456']) assert.equal(isPlaybackPage(path), true, path);
  for (const path of ['/', '/video/', '/video/BV1?x', '/video/not-a-video',
    '/bangumi/', '/bangumi/play/', '/bangumi/play/ep123evil', '/live/1', '/cheese/play/ep1']) {
    assert.equal(isPlaybackPage(path), false, path);
  }
});

test('playback identity ignores tracking and anchors but includes videos, parts and list selections', () => {
  const origin = 'https://www.bilibili.com';
  const original = playbackKey(`${origin}/video/BVabc/`);
  assert.equal(playbackKey(`${origin}/video/BVabc?p=1&spm_id_from=333#reply`), original);
  for (const path of ['/video/BVnext/', '/video/BVabc/?p=2', '/video/BVabc/?cid=456']) {
    assert.notEqual(playbackKey(`${origin}${path}`), original);
  }
  assert.notEqual(playbackKey(`${origin}/list/ml123?oid=1`), playbackKey(`${origin}/list/ml123?oid=2`));
  assert.equal(playbackKey(`${origin}/list/ml123?bvid=BVabc&oid=2`), playbackKey(`${origin}/list/ml123?oid=2&bvid=BVabc&spm=x`));
});

test('temporary speed identity groups ordinary video parts but separates videos, episodes and list items', () => {
  const origin = 'https://www.bilibili.com';
  const original = videoKey(`${origin}/video/BVabc/`);
  for (const suffix of ['?p=2', '?cid=456&p=3', '?aid=123&bvid=BVabc&spm=333#reply']) {
    assert.equal(videoKey(`${origin}/video/BVabc${suffix}`), original);
  }
  assert.notEqual(videoKey(`${origin}/video/BVnext/`), original);
  assert.notEqual(videoKey(`${origin}/bangumi/play/ep1`), videoKey(`${origin}/bangumi/play/ep2`));
  assert.notEqual(videoKey(`${origin}/bangumi/play/ss1?ep_id=1`), videoKey(`${origin}/bangumi/play/ss1?ep_id=2`));
  assert.notEqual(videoKey(`${origin}/list/ml1?oid=1`), videoKey(`${origin}/list/ml1?oid=2`));
  assert.equal(videoKey(`${origin}/list/ml1?oid=1&p=2&cid=1`), videoKey(`${origin}/list/ml1?oid=1&p=3&cid=2`));
});


test('custom slider stops retain 0.25 followed by every tenth through 10', () => {
  assert.equal(CUSTOM_RATES.length, 99);
  assert.deepEqual(CUSTOM_RATES.slice(0, 4), [0.25, 0.3, 0.4, 0.5]);
  assert.equal(CUSTOM_RATES.at(-1), 10);
  for (let index = 0; index < CUSTOM_RATES.length; index++) {
    const rate = CUSTOM_RATES[index]!;
    assert.equal(customRateIndex(rate), index);
    if (index > 0) assert.equal(rate, (index + 2) / 10);
  }
  assert.equal(CUSTOM_RATES.includes(0.89), false);
  assert.equal(CUSTOM_RATES.includes(1.37), false);
});

test('custom slider selects the nearest stop without changing native rate precision', () => {
  for (const [rate, expected] of [[0.26, 0.25], [0.274, 0.25], [0.275, 0.3], [0.89, 0.9],
    [1.25, 1.3], [1.37, 1.4], [2.75, 2.8], [9.99, 10], [-1, 0.25], [11, 10], [NaN, 1]]) {
    assert.equal(CUSTOM_RATES[customRateIndex(rate)], expected);
  }
  assert.deepEqual(parseRate('1.25'), { ok: true, rate: 1.25 });
});

test('temporary right-arrow speed switches at 3x, preserves fractional precision, and caps at 10x', async () => {
  const { fastForwardRate } = await import('../src/rate.ts');
  for (const [base, temporary] of [[0.25, 3], [1.5, 3], [2.9, 3], [3, 4.5], [3.1, 4.65],
    [4.1, 6.15], [6.6, 9.9], [6.7, 10], [7, 10], [10, 10]]) {
    assert.equal(fastForwardRate(base!), temporary);
  }
});
