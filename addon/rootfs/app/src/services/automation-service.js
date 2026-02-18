const crypto = require('crypto');
const fs = require('fs');
const yaml = require('js-yaml');

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

function normalizeString(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
}

function normalizeLabels(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry).trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value.split(',').map((entry) => entry.trim()).filter(Boolean);
  }
  return [];
}

function extractClassificationFromConfig(config) {
  const metadata = config && typeof config === 'object' ? (config.metadata || config.meta || {}) : {};
  const category = normalizeString(config?.category || metadata.category || '');
  const room = normalizeString(config?.room || metadata.room || '');
  const labels = normalizeLabels(config?.labels || metadata.labels || []);

  return { category, room, labels };
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

  resolveYamlStatus(record) {
    const preferred = record.status === 'quarantine' ? 'quarantine' : 'active';
    if (this.gitBackup.fileExists(preferred, record.id)) {
      return preferred;
    }

    const fallback = preferred === 'active' ? 'quarantine' : 'active';
    if (this.gitBackup.fileExists(fallback, record.id)) {
      return fallback;
    }

    return preferred;
  }

  async importFromHa({ automaticCommit = false } = {}) {
    const automations = await this.haClient.listAutomations();
    const seenIds = new Set();
    let importedCount = 0;
    let failedCount = 0;
    let autoQuarantinedCount = 0;
    let migratedCount = 0;
    let cleanedLegacyQuarantineCount = 0;

    for (const automation of automations) {
      const automationId = automation.entity_id || automation.id;
      if (!automationId) {
        continue;
      }

      try {
        const legacyIds = [
          automation.id,
          automation.ha_unique_id,
        ].filter((value) => value && value !== automationId);

        let existing = this.store.getAutomation(automationId);
        for (const legacyId of legacyIds) {
          const legacy = this.store.getAutomation(legacyId);
          if (!legacy) {
            continue;
          }

          if (!existing) {
            existing = legacy;
            migratedCount += 1;
          }

          if (legacy.status === 'quarantine') {
            this.gitBackup.deleteQuarantine(legacyId);
            cleanedLegacyQuarantineCount += 1;
          } else {
            const legacyActivePath = this.gitBackup.yamlPath('active', legacyId);
            if (fs.existsSync(legacyActivePath)) {
              fs.unlinkSync(legacyActivePath);
            }
          }
          this.store.deleteAutomation(legacyId);
        }

        seenIds.add(automationId);

        const config = (await this.haClient.getAutomationConfig(automationId)) || automation.raw_config || automation;
        const importedClassification = extractClassificationFromConfig(config);
        const yamlHash = this.buildYamlHash(config);
        const previouslyMissing = existing && existing.status === 'quarantine' && existing.autoQuarantined;

        this.gitBackup.writeYaml('active', automationId, config);

        this.store.upsertAutomation(automationId, {
          id: automationId,
          entityId: automation.entity_id || existing?.entityId || automationId,
          editId: automation.edit_id || automation.ha_unique_id || existing?.editId || '',
          alias: automation.alias || automation.name || automationId,
          yamlHash,
          lastImportedAt: new Date().toISOString(),
          lastSeenInHa: new Date().toISOString(),
          status: 'active',
          autoQuarantined: false,
          haUniqueId: automation.ha_unique_id || existing?.haUniqueId || '',
          category: importedClassification.category || existing?.category || '',
          labels: importedClassification.labels.length ? importedClassification.labels : (existing?.labels || []),
          room: importedClassification.room || existing?.room || '',
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
        const existsInHa = await this.haClient.automationExists(record.entityId || record.id);
        if (existsInHa) {
          continue;
        }

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
        `chore(sync): import changed=${importedCount}, quarantined=${autoQuarantinedCount}, failed=${failedCount}, migrated=${migratedCount}`
      );
    }

    const tracked = this.store.listAutomations();
    const activeCount = tracked.filter((entry) => entry.status === 'active').length;
    const quarantineCount = tracked.filter((entry) => entry.status === 'quarantine').length;

    console.log(
      `Import summary: discovered=${automations.length}, changed=${importedCount}, failed=${failedCount}, active=${activeCount}, quarantine=${quarantineCount}, migrated=${migratedCount}, cleaned_legacy_quarantine=${cleanedLegacyQuarantineCount}`
    );

    return {
      importedCount,
      total: automations.length,
      failedCount,
      activeCount,
      quarantineCount,
      trackedCount: tracked.length,
      migratedCount,
      cleanedLegacyQuarantineCount,
      autoCommit,
    };
  }

  listAutomations() {
    return this.store.listAutomations();
  }

  listWarnings() {
    return this.store.listWarnings();
  }

  clearWarning(id) {
    this.store.removeWarning(id);
    return { removed: true, id };
  }

  clearWarnings() {
    this.store.clearWarnings();
    return { removedAll: true };
  }

  getRawConfiguration(id) {
    const record = this.store.getAutomation(id);
    if (!record) {
      throw new Error('Automation does not exist in local catalog.');
    }

    const status = this.resolveYamlStatus(record);
    const yamlText = this.gitBackup.readYamlText(status, id);
    if (yamlText == null) {
      throw new Error('Backup YAML file is missing for selected automation.');
    }

    const activeRelPath = this.gitBackup.relativeYamlPath('active', id);
    const quarantineRelPath = this.gitBackup.relativeYamlPath('quarantine', id);
    const historyRaw = this.gitBackup.listHistoryForPaths([activeRelPath, quarantineRelPath], 80);
    const seenCommits = new Set();
    const history = historyRaw.filter((entry) => {
      if (seenCommits.has(entry.commit)) {
        return false;
      }
      seenCommits.add(entry.commit);
      return true;
    });

    return {
      id,
      status,
      alias: record.alias || id,
      yamlText,
      history,
      canApplyToHa: status === 'active',
    };
  }

  getRawConfigurationVersion(id, commit) {
    if (!commit) {
      throw new Error('Commit hash is required.');
    }

    const activeRelPath = this.gitBackup.relativeYamlPath('active', id);
    const quarantineRelPath = this.gitBackup.relativeYamlPath('quarantine', id);

    const activeText = this.gitBackup.readFileAtCommit(commit, activeRelPath);
    if (activeText != null) {
      return {
        commit,
        status: 'active',
        yamlText: activeText,
      };
    }

    const quarantineText = this.gitBackup.readFileAtCommit(commit, quarantineRelPath);
    if (quarantineText != null) {
      return {
        commit,
        status: 'quarantine',
        yamlText: quarantineText,
      };
    }

    throw new Error('Selected commit does not contain this automation YAML.');
  }

  async updateRawConfiguration(id, payload) {
    const record = this.store.getAutomation(id);
    if (!record) {
      throw new Error('Automation does not exist in local catalog.');
    }

    const yamlText = String(payload?.yamlText || '');
    const parsed = yaml.load(yamlText);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Raw configuration must be a valid YAML object.');
    }

    const status = this.resolveYamlStatus(record);
    this.gitBackup.writeYamlText(status, id, yamlText);

    if (payload?.applyToHa) {
      if (status !== 'active') {
        throw new Error('Cannot apply quarantined automation directly to HA. Restore it first.');
      }
      const targetId = record.entityId || record.id;
      await this.haClient.upsertAutomation(targetId, parsed);
    }

    const yamlHash = this.buildYamlHash(parsed);
    const importedClassification = extractClassificationFromConfig(parsed);
    this.store.upsertAutomation(id, {
      yamlHash,
      updatedAt: new Date().toISOString(),
      category: importedClassification.category || record.category || '',
      labels: importedClassification.labels.length ? importedClassification.labels : (record.labels || []),
      room: importedClassification.room || record.room || '',
    });

    this.gitBackup.writeMetadata(this.store.state);
    const commitMessage = String(payload?.commitMessage || '').trim() || `feat(raw): update automation ${id}`;
    const commit = this.gitBackup.commit(commitMessage);

    return {
      id,
      status,
      commit,
    };
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
          editId: record.editId || '',
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
