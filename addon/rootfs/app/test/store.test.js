const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { StoreService } = require('../src/services/store');

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('StoreService persists automations and warnings', () => {
  const baseDir = tempDir('ha-am-store-');
  const store = new StoreService(baseDir);

  const record = store.upsertAutomation('automation.test_a', {
    alias: 'Test A',
    category: 'lights',
    labels: ['kitchen'],
    room: 'kitchen',
    status: 'active',
  });

  assert.equal(record.id, 'automation.test_a');
  assert.equal(store.listAutomations().length, 1);

  store.addWarning('automation.test_a missing from HA');
  assert.equal(store.listWarnings().length, 1);

  const reloaded = new StoreService(baseDir);
  assert.equal(reloaded.listAutomations().length, 1);
  assert.equal(reloaded.listWarnings().length, 1);
});
