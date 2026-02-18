const crypto = require('crypto');

function extractDeviceRefs(node, collector = new Set()) {
  if (Array.isArray(node)) {
    node.forEach((entry) => extractDeviceRefs(entry, collector));
    return collector;
  }

  if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      const isEntityKey = key === 'entity_id' || key === 'device_id';
      if (isEntityKey) {
        if (Array.isArray(value)) {
          value.forEach((item) => collector.add(String(item)));
        } else if (value) {
          collector.add(String(value));
        }
      } else {
        extractDeviceRefs(value, collector);
      }
    }
  }

  return collector;
}

class AutomationService {
  constructor({ store, haClient, gitBackup }) {
    this.store = store;
    this.haClient = haClient;
    this.gitBackup = gitBackup;
  }

  buildYamlHash(payload) {
    return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  }

  async importFromHa({ automaticCommit = false } = {}) {
    const automations = await this.haClient.listAutomations();
    const seenIds = new Set();
    let importedCount = 0;
    let failedCount = 0;
    let autoQuarantinedCount = 0;

    for (const automation of automations) {
      const automationId = automation.id || automation.entity_id;
      if (!automationId) {
        continue;
      }

      try {
        seenIds.add(automationId);

        const config = (await this.haClient.getAutomationConfig(automationId)) || automation.raw_config || automation;
        const yamlHash = this.buildYamlHash(config);
        const existing = this.store.getAutomation(automationId);
        const previouslyMissing = existing && existing.status === 'quarantine' && existing.autoQuarantined;

        this.gitBackup.writeYaml('active', automationId, config);

        this.store.upsertAutomation(automationId, {
          id: automationId,
          alias: automation.alias || automation.name || automationId,
          yamlHash,
          lastImportedAt: new Date().toISOString(),
          lastSeenInHa: new Date().toISOString(),
          status: 'active',
          autoQuarantined: false,
          category: existing?.category || '',
          labels: existing?.labels || [],
          room: existing?.room || '',
        });

        if (!existing || existing.yamlHash !== yamlHash || previouslyMissing) {
          importedCount += 1;
        }
      } catch (error) {
        failedCount += 1;
        console.warn(`Skipping automation ${automationId} due to import error:`, error.message);
      }
    }

    const known = this.store.listAutomations();
    for (const record of known) {
      if (record.status === 'active' && !seenIds.has(record.id)) {
        this.store.upsertAutomation(record.id, {
          status: 'quarantine',
          autoQuarantined: true,
          quarantinedAt: new Date().toISOString(),
        });

        this.gitBackup.moveToQuarantine(record.id);
        this.store.addWarning(`Automation ${record.id} disappeared from Home Assistant and was moved to quarantine.`);
        autoQuarantinedCount += 1;
      }
    }

    this.store.setLastSync(new Date().toISOString());
    this.gitBackup.writeMetadata(this.store.state);

    let autoCommit = null;
    if (automaticCommit) {
      autoCommit = this.gitBackup.commit(
        `chore(sync): import changed=${importedCount}, quarantined=${autoQuarantinedCount}, failed=${failedCount}`
      );
    }

    const tracked = this.store.listAutomations();
    const activeCount = tracked.filter((entry) => entry.status === 'active').length;
    const quarantineCount = tracked.filter((entry) => entry.status === 'quarantine').length;

    console.log(
      `Import summary: discovered=${automations.length}, changed=${importedCount}, failed=${failedCount}, active=${activeCount}, quarantine=${quarantineCount}`
    );

    return {
      importedCount,
      total: automations.length,
      failedCount,
      activeCount,
      quarantineCount,
      trackedCount: tracked.length,
      autoCommit,
    };
  }

  listAutomations() {
    return this.store.listAutomations();
  }

  listWarnings() {
    return this.store.listWarnings();
  }

  updateMetadata(id, payload) {
    const labels = Array.isArray(payload.labels)
      ? payload.labels.map((value) => String(value).trim()).filter(Boolean)
      : [];

    const category = payload.category ? String(payload.category).trim() : '';
    const room = payload.room ? String(payload.room).trim() : '';

    const updated = this.store.upsertAutomation(id, {
      category,
      labels,
      room,
      updatedAt: new Date().toISOString(),
    });

    this.gitBackup.writeMetadata(this.store.state);
    return updated;
  }

  async quarantineAutomation(id, { confirmed }) {
    if (!confirmed) {
      throw new Error('Quarantine requires confirmed=true to remove automation from Home Assistant.');
    }

    const record = this.store.getAutomation(id);
    if (!record || record.status !== 'active') {
      throw new Error('Automation is not active or does not exist.');
    }

    await this.haClient.deleteAutomation(id);
    this.gitBackup.moveToQuarantine(id);

    const updated = this.store.upsertAutomation(id, {
      status: 'quarantine',
      autoQuarantined: false,
      quarantinedAt: new Date().toISOString(),
    });

    this.gitBackup.writeMetadata(this.store.state);
    return updated;
  }

  async restoreAutomation(id) {
    const record = this.store.getAutomation(id);
    if (!record || record.status !== 'quarantine') {
      throw new Error('Automation is not in quarantine.');
    }

    const quarantinePath = this.gitBackup.yamlPath('quarantine', id);
    const fs = require('fs');
    const yaml = require('js-yaml');

    if (!fs.existsSync(quarantinePath)) {
      throw new Error('Missing quarantine YAML backup for selected automation.');
    }

    const parsed = yaml.load(fs.readFileSync(quarantinePath, 'utf8'));
    await this.haClient.upsertAutomation(id, parsed);

    this.gitBackup.moveToActive(id);
    const updated = this.store.upsertAutomation(id, {
      status: 'active',
      restoredAt: new Date().toISOString(),
      autoQuarantined: false,
    });

    this.gitBackup.writeMetadata(this.store.state);
    return updated;
  }

  deleteFromQuarantine(id, { confirmed }) {
    if (!confirmed) {
      throw new Error('Permanent delete requires confirmed=true.');
    }

    const record = this.store.getAutomation(id);
    if (!record || record.status !== 'quarantine') {
      throw new Error('Automation is not in quarantine.');
    }

    this.gitBackup.deleteQuarantine(id);
    this.store.deleteAutomation(id);
    this.gitBackup.writeMetadata(this.store.state);

    return { deleted: true, id };
  }

  buildDeviceView() {
    const output = {};
    const fs = require('fs');
    const yaml = require('js-yaml');

    for (const record of this.store.listAutomations()) {
      const status = record.status === 'quarantine' ? 'quarantine' : 'active';
      const yamlPath = this.gitBackup.yamlPath(status, record.id);
      if (!fs.existsSync(yamlPath)) {
        continue;
      }

      let parsed;
      try {
        parsed = yaml.load(fs.readFileSync(yamlPath, 'utf8'));
      } catch (error) {
        continue;
      }

      const refs = [...extractDeviceRefs(parsed)];
      for (const ref of refs) {
        if (!output[ref]) {
          output[ref] = {
            deviceId: ref,
            automationIds: [],
          };
        }

        output[ref].automationIds.push({
          id: record.id,
          alias: record.alias || record.id,
          status: record.status,
          category: record.category || '',
          room: record.room || '',
          labels: record.labels || [],
        });
      }
    }

    return Object.values(output).sort((a, b) => a.deviceId.localeCompare(b.deviceId));
  }

  commit(message) {
    return this.gitBackup.commit(message || 'chore: update automation backup state');
  }

  push() {
    return this.gitBackup.push();
  }
}

module.exports = {
  AutomationService,
};
