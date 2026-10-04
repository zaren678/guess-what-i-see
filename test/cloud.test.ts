import {test} from 'node:test';
import assert from 'node:assert/strict';
import {isLocalHostname, resolveRoom} from '../src/game/cloud';

test('isLocalHostname keeps the link dormant off-deployment', () => {
  for (const host of [
    'localhost',
    'LOCALHOST',
    '127.0.0.1',
    '[::1]',
    '0.0.0.0',
    'laptop.local',
    '192.168.1.5',
    '10.0.0.2',
    '172.16.0.1',
    '172.31.255.255',
  ]) {
    assert.equal(isLocalHostname(host), true, host);
  }
  for (const host of [
    'guess-what-i-see.vercel.app',
    '8.8.8.8',
    '172.15.0.1',
    '172.32.0.1',
    'example.local.evil.com',
  ]) {
    assert.equal(isLocalHostname(host), false, host);
  }
});

test('resolveRoom defaults without a browser', () => {
  assert.equal(resolveRoom(), 'primary');
});
