const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { StoreService } = require('../src/services/store');
const { AutomationService, extractDeviceRefs } = require('../src/services/automation-service');

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

class FakeHaClient {
  constructor(items = []) {
    this.items = items;
    this.deleted = [];
    this.upserted = [];
    this.metadataUpdates = [];
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

  async resolveDeviceReference(reference) {
    const value = String(reference || '').trim();
    if (value === '0163d78db1e36467e298496641d861c3') {
      return [
        {
          key: 'media_player.nestmini1128',
          display: 'media_player.nestmini1128',
          sourceDeviceId: value,
        },
      ];
    }

    return [
      {
        key: value,
        display: value,
      },
    ];
  }

  async updateAutomationMetadata(entityId, payload) {
    this.metadataUpdates.push({ entityId, payload });
    return { applied: true };
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

  fileExists(status, automationId) {
    return fs.existsSync(this.yamlPath(status, automationId));
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

  hasChanges() {
    return false;
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
  const haClient = new FakeHaClient([
    {
      id: 'automation.other',
      entity_id: 'automation.other',
      alias: 'Other',
      raw_config: { alias: 'Other', trigger: [], action: [] },
    },
  ]);
  const gitBackup = new FakeGitBackup(repoDir);

  store.upsertAutomation('automation.missing', {
    id: 'automation.missing',
    alias: 'Missing',
    status: 'active',
  });
  gitBackup.writeYaml('active', 'automation.missing', { alias: 'Missing', action: [] });

  const service = new AutomationService({ store, haClient, gitBackup });
  await service.importFromHa({ automaticCommit: false });
  let updated = store.getAutomation('automation.missing');
  assert.equal(updated.status, 'active');

  await service.importFromHa({ automaticCommit: false });
  updated = store.getAutomation('automation.missing');
  assert.equal(updated.status, 'active');

  await service.importFromHa({ automaticCommit: false });
  updated = store.getAutomation('automation.missing');
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

test('AutomationService does not quarantine when HA existence check confirms automation', async () => {
  const storeDir = tempDir('ha-am-store-');
  const repoDir = tempDir('ha-am-git-');
  const store = new StoreService(storeDir);
  const haClient = new FakeHaClient([]);
  haClient.automationExists = async () => true;
  const gitBackup = new FakeGitBackup(repoDir);

  store.upsertAutomation('automation.exists_in_ha', {
    id: 'automation.exists_in_ha',
    alias: 'Exists in HA',
    status: 'active',
  });
  gitBackup.writeYaml('active', 'automation.exists_in_ha', { alias: 'Exists in HA', action: [] });

  const service = new AutomationService({ store, haClient, gitBackup });
  await service.importFromHa({ automaticCommit: false });

  const updated = store.getAutomation('automation.exists_in_ha');
  assert.equal(updated.status, 'active');
  assert.equal(store.listWarnings().length, 0);
});

test('extractDeviceRefs extracts entity_id from templates and direct fields', () => {
  const parsed = {
    condition: [
      {
        condition: 'template',
        value_template: "{{ states('input_select.hall_scenes') }}",
      },
    ],
    trigger: [
      {
        platform: 'state',
        entity_id: 'binary_sensor.hall_motion',
      },
    ],
  };

  const refs = [...extractDeviceRefs(parsed)].sort((a, b) => a.localeCompare(b));
  assert.deepEqual(refs, ['binary_sensor.hall_motion', 'input_select.hall_scenes']);
});

test('buildDeviceView maps UUID device_id values to entity_ids', async () => {
  const storeDir = tempDir('ha-am-store-');
  const repoDir = tempDir('ha-am-git-');
  const store = new StoreService(storeDir);
  const haClient = new FakeHaClient([
    {
      id: 'automation.device_uuid',
      entity_id: 'automation.device_uuid',
      alias: 'Device UUID',
      raw_config: {
        alias: 'Device UUID',
        trigger: [],
        condition: [],
        action: [
          {
            device_id: '0163d78db1e36467e298496641d861c3',
          },
        ],
      },
    },
  ]);
  const gitBackup = new FakeGitBackup(repoDir);

  const service = new AutomationService({ store, haClient, gitBackup });
  await service.importFromHa({ automaticCommit: false });

  const devices = await service.buildDeviceView();
  const target = devices.find((entry) => entry.deviceId === 'media_player.nestmini1128');
  assert.ok(target);
  assert.equal(target.automationIds.length, 1);
  assert.equal(target.automationIds[0].id, 'automation.device_uuid');
  assert.deepEqual(target.sourceDeviceIds, ['0163d78db1e36467e298496641d861c3']);
});

test('buildDeviceView sorts devices by automation count descending', async () => {
  const storeDir = tempDir('ha-am-store-');
  const repoDir = tempDir('ha-am-git-');
  const store = new StoreService(storeDir);
  const haClient = new FakeHaClient([
    {
      id: 'automation.one',
      entity_id: 'automation.one',
      alias: 'One',
      raw_config: {
        alias: 'One',
        trigger: [{ platform: 'state', entity_id: 'sensor.dev_a' }],
        action: [{ service: 'light.turn_on', target: { entity_id: 'light.dev_a' } }],
      },
    },
    {
      id: 'automation.two',
      entity_id: 'automation.two',
      alias: 'Two',
      raw_config: {
        alias: 'Two',
        trigger: [{ platform: 'state', entity_id: 'sensor.dev_a' }],
        action: [{ service: 'light.turn_on', target: { entity_id: 'light.dev_b' } }],
      },
    },
  ]);
  const gitBackup = new FakeGitBackup(repoDir);
  const service = new AutomationService({ store, haClient, gitBackup });
  await service.importFromHa({ automaticCommit: false });

  const list = await service.buildDeviceView();
  assert.ok(list.length >= 2);
  assert.equal(list[0].deviceId, 'sensor.dev_a');
  assert.equal(list[0].automationIds.length, 2);
});

test('validateRawYaml reports syntax errors and structural warnings', () => {
  const storeDir = tempDir('ha-am-store-');
  const repoDir = tempDir('ha-am-git-');
  const store = new StoreService(storeDir);
  const haClient = new FakeHaClient([]);
  const gitBackup = new FakeGitBackup(repoDir);
  const service = new AutomationService({ store, haClient, gitBackup });

  assert.throws(
    () => service.validateRawYaml({ yamlText: 'alias: test\naction: [' }),
    /YAML syntax error/
  );

  const result = service.validateRawYaml({
    yamlText: 'alias: test\naction:\n  service: light.turn_on\n',
  });
  assert.equal(result.valid, true);
  assert.equal(result.warnings.length, 1);
});

test('updateMetadata applies metadata to HA by default and stores it locally', async () => {
  const storeDir = tempDir('ha-am-store-');
  const repoDir = tempDir('ha-am-git-');
  const store = new StoreService(storeDir);
  const haClient = new FakeHaClient([
    {
      id: 'automation.meta_test',
      entity_id: 'automation.meta_test',
      alias: 'Meta test',
      raw_config: {
        alias: 'Meta test',
        trigger: [],
        condition: [],
        action: [],
      },
    },
  ]);
  const gitBackup = new FakeGitBackup(repoDir);
  const service = new AutomationService({ store, haClient, gitBackup });
  await service.importFromHa({ automaticCommit: false });

  const updated = await service.updateMetadata('automation.meta_test', {
    category: 'alarm',
    labels: ['critical', 'night'],
    room: 'hall',
  });

  assert.equal(updated.category, 'alarm');
  assert.deepEqual(updated.labels, ['critical', 'night']);
  assert.equal(updated.room, 'hall');
  assert.equal(updated.haApplied, true);
  assert.equal(haClient.metadataUpdates.length, 1);
  assert.equal(haClient.metadataUpdates[0].entityId, 'automation.meta_test');
});
