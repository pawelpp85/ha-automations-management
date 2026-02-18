const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const WebSocket = require('ws');

const HA_WS_TIMEOUT_MS = 12000;

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
    this.globalAutomationConfigApiSupported = true;
    this.itemAutomationConfigApiSupported = true;

    this.warnedUnsupportedWsApi = false;
    this.warnedUnsupportedListApi = false;
    this.warnedUnsupportedItemApi = false;
    this.warnedDedicatedConfigError = false;

    this.cachedConfigs = new Map();
    this.entityIdByAutomationId = new Map();
    this.yamlPath = process.env.HA_AUTOMATIONS_YAML_PATH || '/config/automations.yaml';
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

  readYamlAutomations() {
    if (!fs.existsSync(this.yamlPath)) {
      return [];
    }

    try {
      const parsed = yaml.load(fs.readFileSync(this.yamlPath, 'utf8'));
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      console.warn(`Failed to parse ${this.yamlPath}:`, error.message);
      return [];
    }
  }

  async listViaWsApi() {
    const client = await this.createWsClient();

    try {
      const entities = await client.request('config/entity_registry/list');
      const automationEntities = (entities || []).filter(
        (entry) => entry && typeof entry.entity_id === 'string' && entry.entity_id.startsWith('automation.')
      );

      const output = [];

      for (const entry of automationEntities) {
        let config = null;

        try {
          const payload = await client.request('automation/config', { entity_id: entry.entity_id });
          config = payload?.config || null;
        } catch (error) {
          if (isUnknownWsCommand(error)) {
            throw error;
          }

          const message = String(error.message || '').toLowerCase();
          if (!message.includes('entity not found') && !message.includes('not found')) {
            throw error;
          }
        }

        const automationId = entry.entity_id;
        const haUniqueId = entry.unique_id || '';
        const alias = config?.alias || entry.original_name || entry.entity_id;

        if (config) {
          this.cachedConfigs.set(automationId, config);
          if (haUniqueId) {
            this.cachedConfigs.set(haUniqueId, config);
          }
          this.entityIdByAutomationId.set(automationId, entry.entity_id);
        }

        output.push({
          id: automationId,
          edit_id: haUniqueId || '',
          alias,
          entity_id: entry.entity_id,
          ha_unique_id: haUniqueId,
          raw_config: config || {
            alias,
            trigger: [],
            condition: [],
            action: [],
          },
        });
      }

      return output;
    } finally {
      client.close();
    }
  }

  async listFromStatesAndYaml() {
    const states = await this.request('/api/states');
    const automations = states.filter((entry) => String(entry.entity_id || '').startsWith('automation.'));
    const yamlAutomations = this.readYamlAutomations();
    const usedIndexes = new Set();

    const output = automations.map((entry) => {
      const entityId = entry.entity_id;
      const alias = entry.attributes?.friendly_name || entityId;
      const aliasSlug = slugify(alias);

      let matchedIndex = -1;

      for (let i = 0; i < yamlAutomations.length; i += 1) {
        if (usedIndexes.has(i)) continue;
        const candidate = yamlAutomations[i] || {};
        const candidateAlias = String(candidate.alias || '');
        const candidateAliasSlug = slugify(candidateAlias);
        const candidateIdSlug = slugify(candidate.id || '');

        if (candidateAlias === alias || candidateAliasSlug === aliasSlug || `automation.${candidateIdSlug}` === entityId) {
          matchedIndex = i;
          break;
        }
      }

      if (matchedIndex >= 0) {
        usedIndexes.add(matchedIndex);
      }

      const rawConfig = matchedIndex >= 0
        ? yamlAutomations[matchedIndex]
        : {
            alias,
            description: entry.attributes?.description || '',
            trigger: [],
            condition: [],
            action: [],
          };

      this.cachedConfigs.set(entityId, rawConfig);
      this.entityIdByAutomationId.set(entityId, entityId);

      return {
        id: entityId,
        edit_id: String(entry.attributes?.id || ''),
        alias,
        entity_id: entityId,
        ha_unique_id: '',
        raw_config: rawConfig,
      };
    });

    return output;
  }

  async listAutomations() {
    if (this.wsAutomationApiSupported) {
      try {
        return await this.listViaWsApi();
      } catch (error) {
        if (isUnknownWsCommand(error)) {
          this.wsAutomationApiSupported = false;
          if (!this.warnedUnsupportedWsApi) {
            console.warn('HA websocket automation/config is unavailable; switching to REST/state fallback.');
            this.warnedUnsupportedWsApi = true;
          }
        } else {
          console.warn('HA websocket list failed, switching to REST/state fallback:', error.message);
        }
      }
    }

    if (this.globalAutomationConfigApiSupported) {
      try {
        const data = await this.request('/api/config/automation/config');
        const list = Array.isArray(data) ? data : [];
        const normalized = [];

        for (const entry of list) {
          const rawId = entry.id || entry.entity_id;
          const id = entry.entity_id || (String(rawId || '').startsWith('automation.') ? rawId : `automation.${rawId}`);
          if (id) {
            const rawConfig = entry.raw_config || entry;
            this.cachedConfigs.set(id, rawConfig);
            if (rawId && rawId !== id) {
              this.cachedConfigs.set(String(rawId), rawConfig);
            }
            const entityId = entry.entity_id || id;
            this.entityIdByAutomationId.set(id, entityId);

            normalized.push({
              id,
              entity_id: entityId,
              edit_id: rawId && String(rawId) !== String(entityId) ? String(rawId) : '',
              ha_unique_id: rawId && String(rawId) !== String(entityId) ? String(rawId) : '',
              alias: entry.alias || entry.name || rawConfig.alias || entityId,
              raw_config: rawConfig,
            });
          }
        }

        return normalized;
      } catch (error) {
        if (isEndpointMissing(error)) {
          this.globalAutomationConfigApiSupported = false;
          if (!this.warnedUnsupportedListApi) {
            console.warn('HA endpoint /api/config/automation/config is unavailable; using /api/states + automations.yaml fallback.');
            this.warnedUnsupportedListApi = true;
          }
        } else {
          console.warn('Failed to list automations via config endpoint, fallback to states:', error.message);
        }
      }
    }

    return this.listFromStatesAndYaml();
  }

  async getAutomationConfig(automationId) {
    if (this.cachedConfigs.has(automationId)) {
      return this.cachedConfigs.get(automationId);
    }

    if (this.wsAutomationApiSupported) {
      try {
        const entityId = this.entityIdByAutomationId.get(automationId) || automationId;
        if (typeof entityId === 'string' && entityId.startsWith('automation.')) {
          const client = await this.createWsClient();
          try {
            const payload = await client.request('automation/config', { entity_id: entityId });
            const config = payload?.config || null;
            if (config) {
              this.cachedConfigs.set(automationId, config);
              this.entityIdByAutomationId.set(automationId, entityId);
            }
            return config;
          } finally {
            client.close();
          }
        }
      } catch (error) {
        if (isUnknownWsCommand(error)) {
          this.wsAutomationApiSupported = false;
        }
      }
    }

    if (!this.itemAutomationConfigApiSupported) {
      return null;
    }

    const safeId = encodeURIComponent(automationId);
    try {
      const config = await this.request(`/api/config/automation/config/${safeId}`);
      this.cachedConfigs.set(automationId, config);
      return config;
    } catch (error) {
      if (isEndpointMissing(error)) {
        this.itemAutomationConfigApiSupported = false;
        if (!this.warnedUnsupportedItemApi) {
          console.warn('HA endpoint /api/config/automation/config/:id is unavailable; using cached or fallback config only.');
          this.warnedUnsupportedItemApi = true;
        }
        return null;
      }

      if (!this.warnedDedicatedConfigError) {
        console.warn('Could not fetch dedicated automation config; using fallback data only.', error.message);
        this.warnedDedicatedConfigError = true;
      }
      return null;
    }
  }

  async deleteAutomation(automationId) {
    const safeId = encodeURIComponent(automationId);

    try {
      await this.request(`/api/config/automation/config/${safeId}`, {
        method: 'DELETE',
      });
      return;
    } catch (error) {
      if (isEndpointMissing(error)) {
        throw new Error('Your Home Assistant does not expose automation config delete API. Quarantine delete from HA is not available in this mode.');
      }
      throw error;
    }
  }

  async upsertAutomation(automationId, config) {
    const safeId = encodeURIComponent(automationId);

    try {
      return await this.request(`/api/config/automation/config/${safeId}`, {
        method: 'POST',
        body: JSON.stringify(config),
      });
    } catch (error) {
      if (isEndpointMissing(error)) {
        throw new Error('Your Home Assistant does not expose automation config write API. Restore is not available in this mode.');
      }

      return this.request('/api/config/automation/config', {
        method: 'POST',
        body: JSON.stringify({
          id: automationId,
          ...config,
        }),
      });
    }
  }

  async automationExists(entityId) {
    if (!entityId || !String(entityId).startsWith('automation.')) {
      return false;
    }

    try {
      await this.request(`/api/states/${encodeURIComponent(entityId)}`);
      return true;
    } catch (error) {
      if (isEndpointMissing(error)) {
        return false;
      }
      console.warn(`Could not verify automation existence for ${entityId}; skipping quarantine for safety.`, error.message);
      return true;
    }
  }
}

module.exports = {
  HaClient,
  HaHttpError,
};
