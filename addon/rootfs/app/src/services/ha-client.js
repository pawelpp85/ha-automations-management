class HaClient {
  constructor() {
    this.baseUrl = process.env.HA_URL || 'http://supervisor/core';
    this.token = process.env.SUPERVISOR_TOKEN || process.env.HA_TOKEN || '';
  }

  async request(path, options = {}) {
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    };

    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HA request failed (${response.status}) ${path}: ${text}`);
    }

    if (response.status === 204) {
      return null;
    }

    return response.json();
  }

  async listAutomations() {
    try {
      const data = await this.request('/api/config/automation/config');
      return Array.isArray(data) ? data : [];
    } catch (error) {
      console.warn('Falling back to /api/states for automation list:', error.message);
      const states = await this.request('/api/states');
      return states
        .filter((entry) => String(entry.entity_id || '').startsWith('automation.'))
        .map((entry) => ({
          id: entry.entity_id,
          alias: entry.attributes?.friendly_name || entry.entity_id,
          entity_id: entry.entity_id,
          raw_config: {
            alias: entry.attributes?.friendly_name || entry.entity_id,
            description: entry.attributes?.description || '',
          },
        }));
    }
  }

  async getAutomationConfig(automationId) {
    const safeId = encodeURIComponent(automationId);
    try {
      return await this.request(`/api/config/automation/config/${safeId}`);
    } catch (error) {
      console.warn(`Could not fetch dedicated config for ${automationId}:`, error.message);
      return null;
    }
  }

  async deleteAutomation(automationId) {
    const safeId = encodeURIComponent(automationId);
    await this.request(`/api/config/automation/config/${safeId}`, {
      method: 'DELETE',
    });
  }

  async upsertAutomation(automationId, config) {
    const safeId = encodeURIComponent(automationId);

    try {
      return await this.request(`/api/config/automation/config/${safeId}`, {
        method: 'POST',
        body: JSON.stringify(config),
      });
    } catch (error) {
      return this.request('/api/config/automation/config', {
        method: 'POST',
        body: JSON.stringify({
          id: automationId,
          ...config,
        }),
      });
    }
  }
}

module.exports = {
  HaClient,
};
