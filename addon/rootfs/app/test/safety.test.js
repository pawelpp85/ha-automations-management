const test = require('node:test');
const assert = require('node:assert/strict');

const SAFE_HA_URL = /^(https?:\/\/(localhost|127\.0\.0\.1)|http:\/\/supervisor\/core)/;

test('tests must never run in production mode', () => {
  assert.notEqual(process.env.NODE_ENV, 'production');
});

test('tests should use local or supervisor HA endpoint only', () => {
  const haUrl = process.env.HA_URL;
  if (!haUrl) {
    assert.ok(true);
    return;
  }

  assert.match(
    haUrl,
    SAFE_HA_URL,
    'Unsafe HA_URL for tests. Use localhost/127.0.0.1 or http://supervisor/core only.'
  );
});
