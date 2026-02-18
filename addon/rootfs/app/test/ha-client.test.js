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

test('HaClient updateEntityMetadata creates missing room/label/category before assign', async () => {
  const client = new HaClient();
  let updatePayload = null;
  client.createWsClient = async () => new FakeWsClient({
    'config/area_registry/list': async () => [],
    'config/label_registry/list': async () => [],
    'config/category_registry/list': async () => [],
    'config/area_registry/create': async ({ name }) => ({
      area_id: 'area_living_room',
      name,
    }),
    'config/label_registry/create': async ({ name }) => ({
      label_id: 'label_new',
      name,
    }),
    'config/category_registry/create': async ({ name, scope }) => ({
      category_id: 'category_new',
      name,
      scope,
    }),
    'config/entity_registry/update': async (payload) => {
      updatePayload = payload;
      return { success: true };
    },
  });

  const result = await client.updateEntityMetadata('automation.test_missing_meta', {
    room: 'Living Room',
    labels: ['Urgent'],
    category: 'Alarm',
  });

  assert.equal(result.applied, true);
  assert.equal(updatePayload.entity_id, 'automation.test_missing_meta');
  assert.equal(updatePayload.area_id, 'area_living_room');
  assert.deepEqual(updatePayload.labels, ['label_new']);
  assert.equal(updatePayload.categories.automation, 'category_new');
});
