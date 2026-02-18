const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const WebSocket = require('ws');

const HA_WS_TIMEOUT_MS = 12000;
const CATEGORY_SCOPES = ['automation', 'script', 'entity'];
const DOMAIN_SCOPES = {
  automation: ['automation', 'entity'],
  script: ['script', 'entity'],
};

class HaHttpError extends Error {
  constructor(status, requestPath, bodyText) {
    super(`HA request failed (${status}) ${requestPath}: ${bodyText}`);
    this.name = 'HaHttpError';
    this.status = status;
    this.requestPath = requestPath;
    this.bodyText = bodyText;
  }
}

function isEndpointMissing(error) {
  if (error instanceof HaHttpError) {
    return error.status === 404 || error.status === 405;
  }
  const message = String(error?.message || '');
  return message.includes('404') || message.includes('405');
}

function isUnknownWsCommand(error) {
  const message = String(error?.message || '').toLowerCase();
  return message.includes('unknown command') || message.includes('unknown_command');
}

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

class HaClient {
  constructor() {
    this.baseUrl = process.env.HA_URL || 'http://supervisor/core';
    this.token = process.env.SUPERVISOR_TOKEN || process.env.HA_TOKEN || '';

    this.wsAutomationApiSupported = true;
    this.wsScriptApiSupported = true;
    this.globalAutomationConfigApiSupported = true;
    this.globalScriptConfigApiSupported = true;
    this.itemAutomationConfigApiSupported = true;
    this.itemScriptConfigApiSupported = true;

    this.warnedUnsupportedWsApi = false;
    this.warnedUnsupportedWsScriptApi = false;
    this.warnedUnsupportedListApi = false;
    this.warnedUnsupportedScriptListApi = false;
    this.warnedUnsupportedItemApi = false;
    this.warnedUnsupportedScriptItemApi = false;
    this.warnedDedicatedConfigError = false;
    this.warnedDedicatedScriptConfigError = false;

    this.cachedConfigs = new Map();
    this.entityIdByAutomationId = new Map();
    this.entityIdsByDeviceId = new Map();
    this.deviceIdByEntityId = new Map();
    this.deviceNameByDeviceId = new Map();
    this.areaNameById = new Map();
    this.areaIdByName = new Map();
    this.labelNameById = new Map();
    this.labelIdByName = new Map();
    this.categoryIdByNameByScope = new Map();
    this.categoryNameByScope = new Map();
    this.deviceRegistryLoadedAt = 0;
    this.categoryRegistryLoadedAt = 0;
    this.automationsYamlPath = process.env.HA_AUTOMATIONS_YAML_PATH || '/config/automations.yaml';
    this.scriptsYamlPath = process.env.HA_SCRIPTS_YAML_PATH || '/config/scripts.yaml';
  }

  addDeviceEntityLink(deviceId, entityId) {
    const normalizedDeviceId = String(deviceId || '').trim();
    const normalizedEntityId = String(entityId || '').trim();
    if (!normalizedDeviceId || !normalizedEntityId) {
      return;
    }

    if (!this.entityIdsByDeviceId.has(normalizedDeviceId)) {
      this.entityIdsByDeviceId.set(normalizedDeviceId, new Set());
    }

    this.entityIdsByDeviceId.get(normalizedDeviceId).add(normalizedEntityId);
    this.deviceIdByEntityId.set(normalizedEntityId, normalizedDeviceId);
  }

  updateAreaCache(entries) {
    this.areaNameById = new Map();
    this.areaIdByName = new Map();
    for (const entry of entries || []) {
      const areaId = String(entry?.area_id || entry?.id || '').trim();
      if (!areaId) {
        continue;
      }
      const areaName = String(entry?.name || '').trim();
      this.areaNameById.set(areaId, areaName || areaId);
      if (areaName) {
        this.areaIdByName.set(areaName.toLowerCase(), areaId);
      }
    }
  }

  updateLabelCache(entries) {
    this.labelNameById = new Map();
    this.labelIdByName = new Map();
    for (const entry of entries || []) {
      const labelId = String(entry?.label_id || entry?.id || '').trim();
      if (!labelId) {
        continue;
      }
      const labelName = String(entry?.name || '').trim();
      this.labelNameById.set(labelId, labelName || labelId);
      if (labelName) {
        this.labelIdByName.set(labelName.toLowerCase(), labelId);
      }
    }
  }

  updateCategoryScope(scope, entries) {
    const normalizedScope = String(scope || '').trim();
    if (!normalizedScope) {
      return;
    }

    const map = new Map();
    const idByName = new Map();
    for (const entry of entries || []) {
      const categoryId = String(entry?.category_id || entry?.id || '').trim();
      if (!categoryId) {
        continue;
      }
      const categoryName = String(entry?.name || '').trim();
      map.set(categoryId, categoryName || categoryId);
      if (categoryName) {
        idByName.set(categoryName.toLowerCase(), categoryId);
      }
    }

    if (map.size > 0) {
      this.categoryNameByScope.set(normalizedScope, map);
      this.categoryIdByNameByScope.set(normalizedScope, idByName);
    }
  }

  resolveCategoryValue(value, scopes = CATEGORY_SCOPES) {
    const category = String(value || '').trim();
    if (!category) {
      return '';
    }

    for (const scope of scopes) {
      const registry = this.categoryNameByScope.get(scope);
      if (registry?.has(category)) {
        return registry.get(category) || category;
      }
    }

    return category;
  }

  buildHaWsUrl() {
    const parsed = new URL(this.baseUrl);
    parsed.protocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
    parsed.pathname = path.posix.join(parsed.pathname || '/', 'api', 'websocket');
    parsed.search = '';
    return parsed.toString();
  }

  async createWsClient() {
    if (!this.token) {
      throw new Error('Home Assistant token missing for websocket API');
    }

    const wsUrl = this.buildHaWsUrl();

    return new Promise((resolve, reject) => {
      let ready = false;
      let nextId = 1;
      const pending = new Map();
      const ws = new WebSocket(wsUrl);

      const close = () => {
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close();
        }

        for (const entry of pending.values()) {
          clearTimeout(entry.timeout);
          entry.reject(new Error('Home Assistant websocket connection closed'));
        }
        pending.clear();
      };

      const request = (type, payload = {}) =>
        new Promise((resolveRequest, rejectRequest) => {
          if (!ready) {
            rejectRequest(new Error('Home Assistant websocket not ready'));
            return;
          }

          const id = nextId += 1;
          const timeout = setTimeout(() => {
            pending.delete(id);
            rejectRequest(new Error(`Home Assistant websocket request timeout (${type})`));
          }, HA_WS_TIMEOUT_MS);

          pending.set(id, {
            resolve: resolveRequest,
            reject: rejectRequest,
            timeout,
          });

          ws.send(JSON.stringify({ id, type, ...payload }));
        });

      ws.on('message', (raw) => {
        let message;
        try {
          message = JSON.parse(raw.toString());
        } catch (error) {
          return;
        }

        if (message.type === 'auth_required') {
          ws.send(JSON.stringify({ type: 'auth', access_token: this.token }));
          return;
        }

        if (message.type === 'auth_ok') {
          ready = true;
          resolve({ request, close });
          return;
        }

        if (message.type === 'auth_invalid') {
          reject(new Error('Home Assistant websocket auth failed'));
          close();
          return;
        }

        if (message.id && pending.has(message.id)) {
          const entry = pending.get(message.id);
          clearTimeout(entry.timeout);
          pending.delete(message.id);

          if (message.success) {
            entry.resolve(message.result);
          } else {
            entry.reject(new Error(message.error?.message || 'Home Assistant websocket request failed'));
          }
        }
      });

      ws.on('error', (error) => {
        reject(error);
        close();
      });

      ws.on('close', () => {
        if (!ready) {
          reject(new Error('Home Assistant websocket connection closed'));
        }
        close();
      });
    });
  }

  async request(requestPath, options = {}) {
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    };

    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }

    const response = await fetch(`${this.baseUrl}${requestPath}`, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new HaHttpError(response.status, requestPath, text);
    }

    if (response.status === 204) {
      return null;
    }

    return response.json();
  }

  readYamlByDomain(domain) {
    const yamlPath = domain === 'script' ? this.scriptsYamlPath : this.automationsYamlPath;
    if (!fs.existsSync(yamlPath)) {
      return [];
    }

    try {
      const parsed = yaml.load(fs.readFileSync(yamlPath, 'utf8'));
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      console.warn(`Failed to parse ${yamlPath}:`, error.message);
      return [];
    }
  }

  async listViaWsApi(domain = 'automation') {
    const client = await this.createWsClient();

    try {
      const entities = await client.request('config/entity_registry/list');
      let states = [];
      try {
        states = await this.request('/api/states');
      } catch (_error) {
        states = [];
      }
      const stateByEntityId = new Map(
        (states || [])
          .filter((entry) => entry && entry.entity_id)
          .map((entry) => [String(entry.entity_id), String(entry.state || '')])
      );
      let areas = [];
      let labels = [];
      let devices = [];
      const categoriesByScope = {};
      try {
        areas = await client.request('config/area_registry/list');
      } catch (_error) {
        areas = [];
      }
      try {
        labels = await client.request('config/label_registry/list');
      } catch (_error) {
        labels = [];
      }
      try {
        devices = await client.request('config/device_registry/list');
      } catch (_error) {
        devices = [];
      }
      for (const scope of CATEGORY_SCOPES) {
        try {
          categoriesByScope[scope] = await client.request('config/category_registry/list', { scope });
        } catch (_error) {
          categoriesByScope[scope] = [];
        }
      }

      const areaNameById = new Map(
        (areas || []).map((area) => [String(area.area_id || area.id || ''), String(area.name || '')])
      );
      const labelNameById = new Map(
        (labels || []).map((label) => [String(label.label_id || label.id || ''), String(label.name || '')])
      );
      this.updateAreaCache(areas || []);
      this.updateLabelCache(labels || []);
      for (const scope of CATEGORY_SCOPES) {
        this.updateCategoryScope(scope, categoriesByScope[scope] || []);
      }
      this.categoryRegistryLoadedAt = Date.now();
      this.entityIdsByDeviceId.clear();
      this.deviceIdByEntityId.clear();
      this.deviceNameByDeviceId.clear();
      for (const entry of entities || []) {
        this.addDeviceEntityLink(entry?.device_id, entry?.entity_id);
      }
      for (const device of devices || []) {
        const deviceId = String(device?.id || device?.device_id || '').trim();
        if (!deviceId) {
          continue;
        }
        const deviceName = String(
          device?.name_by_user
            || device?.name
            || device?.model
            || ''
        ).trim();
        if (deviceName) {
          this.deviceNameByDeviceId.set(deviceId, deviceName);
        }
      }
      this.deviceRegistryLoadedAt = Date.now();

      const domainPrefix = `${domain}.`;
      const domainEntities = (entities || []).filter(
        (entry) => entry && typeof entry.entity_id === 'string' && entry.entity_id.startsWith(domainPrefix)
      );

      const output = [];
      let staleRegistrySkipped = 0;

      for (const entry of domainEntities) {
        let config = null;
        let configNotFound = false;

        try {
          const payload = await client.request(`${domain}/config`, { entity_id: entry.entity_id });
          config = payload?.config || null;
        } catch (error) {
          if (isUnknownWsCommand(error)) {
            throw error;
          }

          const message = String(error.message || '').toLowerCase();
          if (!message.includes('entity not found') && !message.includes('not found')) {
            throw error;
          }
          configNotFound = true;
        }

        const hasState = stateByEntityId.has(entry.entity_id);
        if (configNotFound && !hasState) {
          staleRegistrySkipped += 1;
          continue;
        }

        const entityId = entry.entity_id;
        const haUniqueId = entry.unique_id || '';
        const alias = config?.alias || entry.original_name || entry.entity_id;
        const areaId = String(entry.area_id || entry.area || '');
        const roomName = areaId ? (areaNameById.get(areaId) || '') : '';
        const rawLabelsSource = Array.isArray(entry.labels)
          ? entry.labels
          : (Array.isArray(entry.label_ids) ? entry.label_ids : []);
        const rawLabels = rawLabelsSource.map((value) => String(value));
        const labelNames = rawLabels.map((labelId) => labelNameById.get(labelId) || labelId).filter(Boolean);
        const stateValue = String(stateByEntityId.get(entry.entity_id) || '').toLowerCase();
        const haEnabled = stateValue ? stateValue !== 'off' : true;
        const rawCategory = String(
          entry.category
            || entry.category_id
            || entry.categories?.[domain]
            || entry.categories?.entity
            || ''
        );
        const category = this.resolveCategoryValue(rawCategory, DOMAIN_SCOPES[domain] || CATEGORY_SCOPES);

        if (config) {
          this.cachedConfigs.set(entityId, config);
          if (haUniqueId) {
            this.cachedConfigs.set(haUniqueId, config);
          }
          this.entityIdByAutomationId.set(entityId, entry.entity_id);
        }

        output.push({
          id: entityId,
          edit_id: haUniqueId || '',
          alias,
          entity_id: entry.entity_id,
          ha_unique_id: haUniqueId,
          room: roomName || areaId,
          area_id: areaId,
          labels: labelNames,
          label_ids: rawLabels,
          label_names: labelNames,
          category,
          ha_enabled: haEnabled,
          raw_config: config || {
            alias,
            trigger: [],
            condition: [],
            action: [],
          },
        });
      }

      if (staleRegistrySkipped > 0) {
        console.warn(
          `Skipped ${staleRegistrySkipped} stale ${domain} registry entries with missing state/config.`
        );
      }

      return output;
    } finally {
      client.close();
    }
  }

  async listFromStatesAndYaml(domain = 'automation') {
    const states = await this.request('/api/states');
    await this.ensureCategoryRegistryCache();
    const domainPrefix = `${domain}.`;
    const entities = states.filter((entry) => String(entry.entity_id || '').startsWith(domainPrefix));
    const yamlEntities = this.readYamlByDomain(domain);
    const usedIndexes = new Set();

    const output = entities.map((entry) => {
      const entityId = entry.entity_id;
      const alias = entry.attributes?.friendly_name || entityId;
      const aliasSlug = slugify(alias);

      let matchedIndex = -1;

      for (let i = 0; i < yamlEntities.length; i += 1) {
        if (usedIndexes.has(i)) continue;
        const candidate = yamlEntities[i] || {};
        const candidateAlias = String(candidate.alias || '');
        const candidateAliasSlug = slugify(candidateAlias);
        const candidateIdSlug = slugify(candidate.id || '');

        if (candidateAlias === alias || candidateAliasSlug === aliasSlug || `${domain}.${candidateIdSlug}` === entityId) {
          matchedIndex = i;
          break;
        }
      }

      if (matchedIndex >= 0) {
        usedIndexes.add(matchedIndex);
      }

      const rawConfig = matchedIndex >= 0
        ? yamlEntities[matchedIndex]
        : {
            alias,
            description: entry.attributes?.description || '',
            ...(domain === 'script'
              ? { sequence: [] }
              : {
                  trigger: [],
                  condition: [],
                  action: [],
                }),
          };

      this.cachedConfigs.set(entityId, rawConfig);
      this.entityIdByAutomationId.set(entityId, entityId);

      return {
        id: entityId,
        edit_id: String(entry.attributes?.id || ''),
        alias,
        entity_id: entityId,
        ha_unique_id: '',
        room: String(entry.attributes?.area_name || ''),
        labels: Array.isArray(entry.attributes?.labels) ? entry.attributes.labels : [],
        label_ids: Array.isArray(entry.attributes?.label_ids) ? entry.attributes.label_ids : [],
        label_names: [],
        category: this.resolveCategoryValue(
          String(entry.attributes?.category || entry.attributes?.category_id || ''),
          DOMAIN_SCOPES[domain] || CATEGORY_SCOPES
        ),
        ha_enabled: String(entry.state || '').toLowerCase() !== 'off',
        raw_config: rawConfig,
      };
    });

    return output;
  }

  async ensureDeviceRegistryCache() {
    const recentlyLoaded = this.deviceRegistryLoadedAt && (Date.now() - this.deviceRegistryLoadedAt) < 120000;
    if (recentlyLoaded && this.entityIdsByDeviceId.size > 0) {
      return;
    }

    try {
      const client = await this.createWsClient();
      try {
        const [entities, devices] = await Promise.all([
          client.request('config/entity_registry/list'),
          client.request('config/device_registry/list').catch(() => []),
        ]);

        this.entityIdsByDeviceId.clear();
        this.deviceIdByEntityId.clear();
        this.deviceNameByDeviceId.clear();
        for (const entry of entities || []) {
          this.addDeviceEntityLink(entry?.device_id, entry?.entity_id);
        }

        for (const device of devices || []) {
          const deviceId = String(device?.id || device?.device_id || '').trim();
          if (!deviceId) {
            continue;
          }
          const deviceName = String(
            device?.name_by_user
              || device?.name
              || device?.model
              || ''
          ).trim();
          if (deviceName) {
            this.deviceNameByDeviceId.set(deviceId, deviceName);
          }
        }
        this.deviceRegistryLoadedAt = Date.now();
      } finally {
        client.close();
      }
    } catch (_error) {
      // Best-effort cache for device->entity mapping.
    }
  }

  async ensureCategoryRegistryCache() {
    const recentlyLoaded = this.categoryRegistryLoadedAt && (Date.now() - this.categoryRegistryLoadedAt) < 120000;
    if (recentlyLoaded && this.categoryNameByScope.size > 0) {
      return;
    }

    try {
      const client = await this.createWsClient();
      try {
        for (const scope of CATEGORY_SCOPES) {
          const categories = await client.request('config/category_registry/list', { scope }).catch(() => []);
          this.updateCategoryScope(scope, categories);
        }
        this.categoryRegistryLoadedAt = Date.now();
      } finally {
        client.close();
      }
    } catch (_error) {
      // Best-effort cache for category_id -> category name.
    }
  }

  async listByDomain(domain) {
    const wsSupportKey = domain === 'script' ? 'wsScriptApiSupported' : 'wsAutomationApiSupported';
    const wsWarnedKey = domain === 'script' ? 'warnedUnsupportedWsScriptApi' : 'warnedUnsupportedWsApi';
    const globalSupportKey = domain === 'script' ? 'globalScriptConfigApiSupported' : 'globalAutomationConfigApiSupported';
    const globalWarnedKey = domain === 'script' ? 'warnedUnsupportedScriptListApi' : 'warnedUnsupportedListApi';
    const itemSupportScopes = DOMAIN_SCOPES[domain] || CATEGORY_SCOPES;
    const domainPrefix = `${domain}.`;

    if (this[wsSupportKey]) {
      try {
        return await this.listViaWsApi(domain);
      } catch (error) {
        if (isUnknownWsCommand(error)) {
          this[wsSupportKey] = false;
          if (!this[wsWarnedKey]) {
            console.warn(`HA websocket ${domain}/config is unavailable; switching to REST/state fallback.`);
            this[wsWarnedKey] = true;
          }
        } else {
          console.warn(`HA websocket ${domain} list failed, switching to REST/state fallback:`, error.message);
        }
      }
    }

    if (this[globalSupportKey]) {
      try {
        await this.ensureCategoryRegistryCache();
        const data = await this.request(`/api/config/${domain}/config`);
        const list = Array.isArray(data) ? data : [];
        const normalized = [];
        let states = [];
        try {
          states = await this.request('/api/states');
        } catch (_error) {
          states = [];
        }
        const stateByEntityId = new Map(
          (states || [])
            .filter((entry) => entry && entry.entity_id)
            .map((entry) => [String(entry.entity_id), String(entry.state || '')])
        );

        for (const entry of list) {
          const rawId = entry.id || entry.entity_id;
          const id = entry.entity_id || (String(rawId || '').startsWith(domainPrefix) ? rawId : `${domain}.${rawId}`);
          if (id) {
            const rawConfig = entry.raw_config || entry;
            this.cachedConfigs.set(id, rawConfig);
            if (rawId && rawId !== id) {
              this.cachedConfigs.set(String(rawId), rawConfig);
            }
            const entityId = entry.entity_id || id;
            const stateValue = String(stateByEntityId.get(entityId) || '').toLowerCase();
            const haEnabled = stateValue ? stateValue !== 'off' : true;
            this.entityIdByAutomationId.set(id, entityId);

            normalized.push({
              id,
              entity_id: entityId,
              edit_id: rawId && String(rawId) !== String(entityId) ? String(rawId) : '',
              ha_unique_id: rawId && String(rawId) !== String(entityId) ? String(rawId) : '',
              alias: entry.alias || entry.name || rawConfig.alias || entityId,
              room: String(entry.room || ''),
              labels: Array.isArray(entry.labels) ? entry.labels : (Array.isArray(entry.label_ids) ? entry.label_ids : []),
              label_ids: Array.isArray(entry.label_ids) ? entry.label_ids : [],
              label_names: Array.isArray(entry.label_names) ? entry.label_names : [],
              category: this.resolveCategoryValue(String(entry.category || entry.category_id || ''), itemSupportScopes),
              ha_enabled: haEnabled,
              raw_config: rawConfig,
            });
          }
        }

        return normalized;
      } catch (error) {
        if (isEndpointMissing(error)) {
          this[globalSupportKey] = false;
          if (!this[globalWarnedKey]) {
            console.warn(`HA endpoint /api/config/${domain}/config is unavailable; using /api/states + YAML fallback.`);
            this[globalWarnedKey] = true;
          }
        } else {
          console.warn(`Failed to list ${domain}s via config endpoint, fallback to states:`, error.message);
        }
      }
    }

    return this.listFromStatesAndYaml(domain);
  }

  async listAutomations() {
    return this.listByDomain('automation');
  }

  async listScripts() {
    return this.listByDomain('script');
  }

  async getConfigByDomain(entityId, domain) {
    if (this.cachedConfigs.has(entityId)) {
      return this.cachedConfigs.get(entityId);
    }

    const wsSupportKey = domain === 'script' ? 'wsScriptApiSupported' : 'wsAutomationApiSupported';
    const itemSupportKey = domain === 'script' ? 'itemScriptConfigApiSupported' : 'itemAutomationConfigApiSupported';
    const warnedItemKey = domain === 'script' ? 'warnedUnsupportedScriptItemApi' : 'warnedUnsupportedItemApi';
    const warnedDedicatedKey = domain === 'script' ? 'warnedDedicatedScriptConfigError' : 'warnedDedicatedConfigError';
    const domainPrefix = `${domain}.`;

    if (this[wsSupportKey]) {
      try {
        const resolvedEntityId = this.entityIdByAutomationId.get(entityId) || entityId;
        if (typeof resolvedEntityId === 'string' && resolvedEntityId.startsWith(domainPrefix)) {
          const client = await this.createWsClient();
          try {
            const payload = await client.request(`${domain}/config`, { entity_id: resolvedEntityId });
            const config = payload?.config || null;
            if (config) {
              this.cachedConfigs.set(entityId, config);
              this.entityIdByAutomationId.set(entityId, resolvedEntityId);
            }
            return config;
          } finally {
            client.close();
          }
        }
      } catch (error) {
        if (isUnknownWsCommand(error)) {
          this[wsSupportKey] = false;
        }
      }
    }

    if (!this[itemSupportKey]) {
      return null;
    }

    const safeId = encodeURIComponent(entityId);
    try {
      const config = await this.request(`/api/config/${domain}/config/${safeId}`);
      this.cachedConfigs.set(entityId, config);
      return config;
    } catch (error) {
      if (isEndpointMissing(error)) {
        this[itemSupportKey] = false;
        if (!this[warnedItemKey]) {
          console.warn(`HA endpoint /api/config/${domain}/config/:id is unavailable; using cached or fallback config only.`);
          this[warnedItemKey] = true;
        }
        return null;
      }

      if (!this[warnedDedicatedKey]) {
        console.warn(`Could not fetch dedicated ${domain} config; using fallback data only.`, error.message);
        this[warnedDedicatedKey] = true;
      }
      return null;
    }
  }

  async getAutomationConfig(automationId) {
    return this.getConfigByDomain(automationId, 'automation');
  }

  async getScriptConfig(scriptId) {
    return this.getConfigByDomain(scriptId, 'script');
  }

  async deleteByDomain(entityId, domain) {
    const safeId = encodeURIComponent(entityId);

    try {
      await this.request(`/api/config/${domain}/config/${safeId}`, {
        method: 'DELETE',
      });
      return;
    } catch (error) {
      if (isEndpointMissing(error)) {
        throw new Error(`Your Home Assistant does not expose ${domain} config delete API. Quarantine delete from HA is not available in this mode.`);
      }
      throw error;
    }
  }

  async deleteAutomation(automationId) {
    return this.deleteByDomain(automationId, 'automation');
  }

  async deleteScript(scriptId) {
    return this.deleteByDomain(scriptId, 'script');
  }

  async upsertByDomain(entityId, config, domain) {
    const safeId = encodeURIComponent(entityId);

    try {
      return await this.request(`/api/config/${domain}/config/${safeId}`, {
        method: 'POST',
        body: JSON.stringify(config),
      });
    } catch (error) {
      if (isEndpointMissing(error)) {
        throw new Error(`Your Home Assistant does not expose ${domain} config write API. Restore is not available in this mode.`);
      }

      return this.request(`/api/config/${domain}/config`, {
        method: 'POST',
        body: JSON.stringify({
          id: entityId,
          ...config,
        }),
      });
    }
  }

  async upsertAutomation(automationId, config) {
    return this.upsertByDomain(automationId, config, 'automation');
  }

  async upsertScript(scriptId, config) {
    return this.upsertByDomain(scriptId, config, 'script');
  }

  async entityExists(entityId, domain = 'automation') {
    if (!entityId || !String(entityId).startsWith(`${domain}.`)) {
      return false;
    }

    try {
      await this.request(`/api/states/${encodeURIComponent(entityId)}`);
      return true;
    } catch (error) {
      if (isEndpointMissing(error)) {
        return false;
      }
      console.warn(`Could not verify ${domain} existence for ${entityId}; skipping quarantine for safety.`, error.message);
      return true;
    }
  }

  async automationExists(entityId) {
    return this.entityExists(entityId, 'automation');
  }

  async scriptExists(entityId) {
    return this.entityExists(entityId, 'script');
  }

  resolveAreaId(value) {
    const room = String(value || '').trim();
    if (!room) {
      return null;
    }

    if (this.areaNameById.has(room)) {
      return room;
    }

    const byName = this.areaIdByName.get(room.toLowerCase());
    return byName || null;
  }

  resolveLabelIds(values) {
    const resolved = [];
    const unknown = [];

    for (const raw of values || []) {
      const value = String(raw || '').trim();
      if (!value) {
        continue;
      }

      if (this.labelNameById.has(value)) {
        resolved.push(value);
        continue;
      }

      const byName = this.labelIdByName.get(value.toLowerCase());
      if (byName) {
        resolved.push(byName);
        continue;
      }

      unknown.push(value);
    }

    return {
      resolved: [...new Set(resolved)],
      unknown,
    };
  }

  resolveCategoryId(value, scopes = CATEGORY_SCOPES) {
    const category = String(value || '').trim();
    if (!category) {
      return null;
    }

    for (const scope of scopes) {
      const byId = this.categoryNameByScope.get(scope);
      if (byId?.has(category)) {
        return category;
      }

      const byName = this.categoryIdByNameByScope.get(scope);
      const resolved = byName?.get(category.toLowerCase());
      if (resolved) {
        return resolved;
      }
    }

    return null;
  }

  async fetchMetadataRegistries(client) {
    const [areas, labels] = await Promise.all([
      client.request('config/area_registry/list').catch(() => []),
      client.request('config/label_registry/list').catch(() => []),
    ]);

    const categoriesByScope = {};
    for (const scope of CATEGORY_SCOPES) {
      categoriesByScope[scope] = await client.request('config/category_registry/list', { scope }).catch(() => []);
    }

    this.updateAreaCache(areas || []);
    this.updateLabelCache(labels || []);
    for (const scope of CATEGORY_SCOPES) {
      this.updateCategoryScope(scope, categoriesByScope[scope] || []);
    }
    this.categoryRegistryLoadedAt = Date.now();
  }

  async updateEntityMetadata(entityId, payload = {}) {
    const targetEntityId = String(entityId || '').trim();
    if (!targetEntityId.startsWith('automation.') && !targetEntityId.startsWith('script.')) {
      throw new Error('Metadata sync to HA requires valid automation/script entity_id.');
    }
    const domain = targetEntityId.startsWith('script.') ? 'script' : 'automation';

    const room = String(payload.room || '').trim();
    const category = String(payload.category || '').trim();
    const labels = Array.isArray(payload.labels)
      ? payload.labels.map((entry) => String(entry).trim()).filter(Boolean)
      : [];

    const client = await this.createWsClient();
    try {
      await this.fetchMetadataRegistries(client);

      const areaId = this.resolveAreaId(room);
      if (room && !areaId) {
        throw new Error(`Room "${room}" was not found in Home Assistant areas.`);
      }

      const labelResult = this.resolveLabelIds(labels);
      if (labelResult.unknown.length) {
        throw new Error(`Unknown HA labels: ${labelResult.unknown.join(', ')}`);
      }

      let categoryId = null;
      if (category) {
        categoryId = this.resolveCategoryId(category, DOMAIN_SCOPES[domain] || CATEGORY_SCOPES);
        if (!categoryId) {
          throw new Error(`Unknown HA category: ${category}`);
        }
      }

      await client.request('config/entity_registry/update', {
        entity_id: targetEntityId,
        area_id: areaId,
        labels: labelResult.resolved,
        categories: {
          [domain]: categoryId,
        },
      });

      return {
        applied: true,
        entityId: targetEntityId,
      };
    } finally {
      client.close();
    }
  }

  async updateAutomationMetadata(entityId, payload = {}) {
    return this.updateEntityMetadata(entityId, payload);
  }

  async resolveDeviceReference(reference) {
    const ref = String(reference || '').trim();
    if (!ref) {
      return [];
    }

    await this.ensureDeviceRegistryCache();

    if (/^[a-z0-9_]+\.[a-z0-9_]+$/i.test(ref)) {
      const sourceDeviceId = this.deviceIdByEntityId.get(ref) || '';
      if (sourceDeviceId) {
        const deviceName = this.deviceNameByDeviceId.get(sourceDeviceId) || ref;
        return [{
          key: sourceDeviceId,
          display: deviceName,
          sourceDeviceId,
        }];
      }

      return [{
        key: ref,
        display: ref,
      }];
    }

    const mapped = this.entityIdsByDeviceId.get(ref);
    if (mapped && mapped.size) {
      const deviceName = this.deviceNameByDeviceId.get(ref) || [...mapped].sort((a, b) => a.localeCompare(b))[0] || ref;
      return [{
        key: ref,
        display: deviceName,
        sourceDeviceId: ref,
      }];
    }

    const deviceName = this.deviceNameByDeviceId.get(ref) || '';
    return [{
      key: ref,
      display: deviceName || ref,
      sourceDeviceId: ref,
    }];
  }
}

module.exports = {
  HaClient,
  HaHttpError,
};
