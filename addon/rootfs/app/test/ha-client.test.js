const test = require('node:test');
const assert = require('node:assert/strict');

const { HaClient } = require('../src/services/ha-client');

class FakeHaClient extends HaClient {
  constructor() {
    super();
  }

  readYamlAutomations() {
    return [];
  }

  async ensureCategoryRegistryCache() {
    this.updateCategoryScope('automation', [
      {
        category_id: '01KCHNEEF1MGZ1MWQYVW0WJMXW',
        name: 'alarm',
      },
    ]);
    this.categoryRegistryLoadedAt = Date.now();
  }

  async request(requestPath) {
    if (requestPath === '/api/states') {
      return [
        {
          entity_id: 'automation.test_alarm',
          state: 'on',
          attributes: {
            friendly_name: 'Test alarm',
            category_id: '01KCHNEEF1MGZ1MWQYVW0WJMXW',
          },
        },
      ];
    }

    throw new Error(`Unexpected request path in test: ${requestPath}`);
  }
}

test('HaClient maps category_id to category name when registry cache is available', async () => {
  const client = new FakeHaClient();
  const list = await client.listFromStatesAndYaml();

  assert.equal(list.length, 1);
  assert.equal(list[0].category, 'alarm');
});

test('HaClient resolveCategoryValue falls back to raw value when mapping is missing', () => {
  const client = new HaClient();
  const raw = '01UNKNOWN';
  assert.equal(client.resolveCategoryValue(raw), raw);
});

class FakeWsClient {
  constructor(handlers) {
    this.handlers = handlers;
  }

  async request(type, payload = {}) {
    if (!this.handlers[type]) {
      throw new Error(`Unhandled ws request type in test: ${type}`);
    }
    return this.handlers[type](payload);
  }

  close() {}
}

test('HaClient listViaWsApi skips stale entity-registry automation without state/config', async () => {
  const client = new HaClient();
  client.createWsClient = async () => new FakeWsClient({
    'config/entity_registry/list': async () => [
      {
        entity_id: 'automation.stale_automation',
        unique_id: '123',
      },
    ],
    'config/area_registry/list': async () => [],
    'config/label_registry/list': async () => [],
    'config/device_registry/list': async () => [],
    'config/category_registry/list': async () => [],
    'automation/config': async () => {
      throw new Error('Entity not found');
    },
  });
  client.request = async (requestPath) => {
    if (requestPath === '/api/states') {
      return [];
    }
    throw new Error(`Unexpected request path in test: ${requestPath}`);
  };

  const list = await client.listViaWsApi();
  assert.equal(list.length, 0);
});
