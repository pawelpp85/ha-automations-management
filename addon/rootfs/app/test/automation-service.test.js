const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { StoreService } = require('../src/services/store');
const { AutomationService } = require('../src/services/automation-service');

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

class FakeHaClient {
  constructor(items = []) {
    this.items = items;
    this.deleted = [];
    this.upserted = [];
  }

  async listAutomations() {
    return this.items;
  }

  async getAutomationConfig(id) {
    const found = this.items.find((item) => (item.id || item.entity_id) === id);
    return found?.raw_config || null;
  }

  async deleteAutomation(id) {
    this.deleted.push(id);
  }

  async upsertAutomation(id, config) {
    this.upserted.push({ id, config });
  }

  async automationExists(entityId) {
    return this.items.some((item) => (item.entity_id || item.id) === entityId);
  }
}

class FakeGitBackup {
  constructor(baseDir) {
    this.baseDir = baseDir;
    this.activeDir = path.join(baseDir, 'active');
    this.quarantineDir = path.join(baseDir, 'quarantine');
    fs.mkdirSync(this.activeDir, { recursive: true });
    fs.mkdirSync(this.quarantineDir, { recursive: true });
    this.commits = [];
  }

  yamlPath(status, automationId) {
    const safe = automationId.replace(/[^a-zA-Z0-9_.-]/g, '_');
    return path.join(status === 'quarantine' ? this.quarantineDir : this.activeDir, `${safe}.yaml`);
  }

  writeYaml(status, automationId, config) {
    const file = this.yamlPath(status, automationId);
    fs.writeFileSync(file, JSON.stringify(config), 'utf8');
    return file;
  }

  moveToQuarantine(automationId) {
    const src = this.yamlPath('active', automationId);
    const dst = this.yamlPath('quarantine', automationId);
    if (fs.existsSync(src)) {
      fs.renameSync(src, dst);
      return dst;
    }
    return null;
  }

  moveToActive(automationId) {
    const src = this.yamlPath('quarantine', automationId);
    const dst = this.yamlPath('active', automationId);
    if (fs.existsSync(src)) {
      fs.renameSync(src, dst);
      return dst;
    }
    return null;
  }

  deleteQuarantine(automationId) {
    const file = this.yamlPath('quarantine', automationId);
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
  }

  writeMetadata(_payload) {}

  commit(message) {
    this.commits.push(message);
    return { created: true };
  }

  push() {
    return { pushed: true };
  }
}

test('AutomationService imports automations and preserves metadata fields', async () => {
  const storeDir = tempDir('ha-am-store-');
  const repoDir = tempDir('ha-am-git-');
  const store = new StoreService(storeDir);
  const haClient = new FakeHaClient([
    {
      id: 'automation.test_import',
      alias: 'Test import',
      raw_config: {
        alias: 'Test import',
        trigger: [{ platform: 'state', entity_id: 'light.kitchen' }],
        action: [{ service: 'light.turn_on', target: { entity_id: 'light.kitchen' } }],
      },
    },
  ]);
  const gitBackup = new FakeGitBackup(repoDir);

  const service = new AutomationService({ store, haClient, gitBackup });
  const result = await service.importFromHa({ automaticCommit: true });

  assert.equal(result.importedCount, 1);
  assert.equal(store.listAutomations().length, 1);
  assert.equal(gitBackup.commits.length, 1);
});

test('AutomationService auto-quarantines missing active automation and emits warning', async () => {
  const storeDir = tempDir('ha-am-store-');
  const repoDir = tempDir('ha-am-git-');
  const store = new StoreService(storeDir);
  const haClient = new FakeHaClient([]);
  const gitBackup = new FakeGitBackup(repoDir);

  store.upsertAutomation('automation.missing', {
    id: 'automation.missing',
    alias: 'Missing',
    status: 'active',
  });
  gitBackup.writeYaml('active', 'automation.missing', { alias: 'Missing', action: [] });

  const service = new AutomationService({ store, haClient, gitBackup });
  await service.importFromHa({ automaticCommit: false });

  const updated = store.getAutomation('automation.missing');
  assert.equal(updated.status, 'quarantine');
  assert.equal(store.listWarnings().length, 1);
});

test('AutomationService quarantine requires explicit confirmation', async () => {
  const storeDir = tempDir('ha-am-store-');
  const repoDir = tempDir('ha-am-git-');
  const store = new StoreService(storeDir);
  const haClient = new FakeHaClient([]);
  const gitBackup = new FakeGitBackup(repoDir);

  store.upsertAutomation('automation.confirm', {
    id: 'automation.confirm',
    alias: 'Confirm',
    status: 'active',
  });

  const service = new AutomationService({ store, haClient, gitBackup });

  await assert.rejects(
    async () => {
      await service.quarantineAutomation('automation.confirm', { confirmed: false });
    },
    /confirmed=true/
  );
});
