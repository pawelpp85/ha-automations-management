const crypto = require('crypto');
const fs = require('fs');
const yaml = require('js-yaml');

const AUTO_QUARANTINE_MISS_THRESHOLD = 3;
const UUID_LIKE_PATTERN = /^[a-f0-9]{32}$/i;
const SCRIPT_ENTITY_PATTERN = /^script\.[a-z0-9_]+$/i;
const RESERVED_SCRIPT_SERVICE_IDS = new Set([
  'script.turn_on',
  'script.turn_off',
  'script.toggle',
  'script.reload',
]);

function addEntityFromString(value, collector, { allowDirectEntityId = false } = {}) {
  const text = String(value || '').trim();
  if (!text) {
    return;
  }

  if (allowDirectEntityId && /^[a-z0-9_]+\.[a-z0-9_]+$/i.test(text)) {
    collector.add(text);
    return;
  }

  const templateMatches = text.matchAll(/\b(?:states|state_attr|is_state|is_state_attr)\s*\(\s*['"]([^'"]+)['"]/gi);
  for (const match of templateMatches) {
    const entityId = String(match?.[1] || '').trim();
    if (/^[a-z0-9_]+\.[a-z0-9_]+$/i.test(entityId)) {
      collector.add(entityId);
    }
  }

  if (text.includes('{{') || text.includes('{%')) {
    const matches = text.matchAll(/\b[a-z_][a-z0-9_]*\.[a-z0-9_]+\b/gi);
    for (const match of matches) {
      const entityId = String(match?.[0] || '').trim();
      if (/^[a-z0-9_]+\.[a-z0-9_]+$/i.test(entityId)) {
        collector.add(entityId);
      }
    }
  }
}

function extractDeviceRefs(node, collector = new Set()) {
  if (Array.isArray(node)) {
    node.forEach((entry) => extractDeviceRefs(entry, collector));
    return collector;
  }

  if (typeof node === 'string') {
    addEntityFromString(node, collector, { allowDirectEntityId: false });
    return collector;
  }

  if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      const isEntityKey = key === 'entity_id' || key === 'device_id';
      if (isEntityKey) {
        if (Array.isArray(value)) {
          value.forEach((item) => {
            if (key === 'device_id') {
              const candidate = String(item || '').trim();
              if (candidate) {
                collector.add(candidate);
              }
            } else {
              addEntityFromString(item, collector, { allowDirectEntityId: true });
            }
          });
        } else if (value) {
          if (key === 'device_id') {
            const candidate = String(value || '').trim();
            if (candidate) {
              collector.add(candidate);
            }
          } else {
            addEntityFromString(value, collector, { allowDirectEntityId: true });
          }
        }
      } else {
        extractDeviceRefs(value, collector);
      }
    }
  }

  return collector;
}

function addLinkedScriptRef(value, collector) {
  const text = String(value || '').trim();
  if (!text || !SCRIPT_ENTITY_PATTERN.test(text)) {
    return;
  }

  const normalized = text.toLowerCase();
  if (RESERVED_SCRIPT_SERVICE_IDS.has(normalized)) {
    return;
  }

  collector.add(normalized);
}

function extractLinkedScriptRefs(node, collector = new Set()) {
  if (Array.isArray(node)) {
    node.forEach((entry) => extractLinkedScriptRefs(entry, collector));
    return collector;
  }

  if (!node || typeof node !== 'object') {
    return collector;
  }

  for (const [key, value] of Object.entries(node)) {
    const keyName = String(key || '').toLowerCase();
    if (keyName === 'action' || keyName === 'service') {
      if (Array.isArray(value)) {
        value.forEach((entry) => addLinkedScriptRef(entry, collector));
      } else {
        addLinkedScriptRef(value, collector);
      }
    }
    extractLinkedScriptRefs(value, collector);
  }

  return collector;
}

function normalizeString(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
}

function normalizeAutomationId(value) {
  return String(value || '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim();
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

function mergeClassification(primary, secondary) {
  return {
    category: normalizeString(primary?.category || '') || normalizeString(secondary?.category || ''),
    room: normalizeString(primary?.room || '') || normalizeString(secondary?.room || ''),
    labels: normalizeLabels(primary?.labels || []).length
      ? normalizeLabels(primary.labels)
      : normalizeLabels(secondary?.labels || []),
  };
}

function normalizeCategory(value) {
  return normalizeString(value);
}

function normalizeEntityType(value) {
  const type = String(value || '').trim().toLowerCase();
  return type === 'script' ? 'script' : 'automation';
}

function canRetryNotFoundDelete(error) {
  const message = String(error?.message || '').toLowerCase();
  return message.includes('resource not found')
    || message.includes('not found')
    || message.includes('(404)')
    || message.includes('(400)');
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

  resolveEntityType(record, fallbackId = '') {
    if (record && record.entityType) {
      return normalizeEntityType(record.entityType);
    }
    const id = String(record?.id || fallbackId || '').trim();
    return id.startsWith('script.') ? 'script' : 'automation';
  }

  listKnownEntities() {
    return this.store.listAutomations().map((entry) => ({
      ...entry,
      entityType: this.resolveEntityType(entry),
    }));
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
    const [automations, scripts] = await Promise.all([
      this.haClient.listAutomations(),
      this.haClient.listScripts(),
    ]);
    const entities = [
      ...(automations || []).map((entry) => ({ ...entry, entityType: 'automation' })),
      ...(scripts || []).map((entry) => ({ ...entry, entityType: 'script' })),
    ];
    const seenIds = new Set();
    let importedCount = 0;
    let failedCount = 0;
    let autoQuarantinedCount = 0;
    let migratedCount = 0;
    let cleanedLegacyQuarantineCount = 0;

    for (const entity of entities) {
      const entityType = normalizeEntityType(entity.entityType);
      const entityId = normalizeAutomationId(entity.entity_id || entity.id);
      if (!entityId) {
        continue;
      }

      try {
        const legacyIds = [
          normalizeAutomationId(entity.id),
          normalizeAutomationId(entity.ha_unique_id),
        ].filter((value) => value && value !== entityId);

        let existing = this.store.getAutomation(entityId);
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

        seenIds.add(entityId);

        const config = (
          entityType === 'script'
            ? await this.haClient.getScriptConfig(entityId)
            : await this.haClient.getAutomationConfig(entityId)
        ) || entity.raw_config || entity;
        const importedClassification = mergeClassification(
          extractClassificationFromConfig(config),
          {
            category: normalizeCategory(entity.category || entity.category_id || ''),
            room: entity.room || entity.area_name || entity.area_id || '',
            labels: entity.labels || entity.label_names || entity.label_ids || [],
          }
        );
        const yamlHash = this.buildYamlHash(config);
        const previouslyMissing = existing && existing.status === 'quarantine' && existing.autoQuarantined;

        this.gitBackup.writeYaml('active', entityId, config);

        this.store.upsertAutomation(entityId, {
          id: entityId,
          entityType,
          entityId: entity.entity_id || existing?.entityId || entityId,
          editId: entity.edit_id || entity.ha_unique_id || existing?.editId || '',
          alias: entity.alias || entity.name || entityId,
          yamlHash,
          lastImportedAt: new Date().toISOString(),
          lastSeenInHa: new Date().toISOString(),
          status: 'active',
          haEnabled: entity.ha_enabled !== false,
          autoQuarantined: false,
          haUniqueId: entity.ha_unique_id || existing?.haUniqueId || '',
          category: importedClassification.category || existing?.category || '',
          labels: importedClassification.labels.length ? importedClassification.labels : (existing?.labels || []),
          room: importedClassification.room || existing?.room || '',
          missingSeenCount: 0,
        });

        if (!existing || existing.yamlHash !== yamlHash || previouslyMissing) {
          importedCount += 1;
        }
      } catch (error) {
        failedCount += 1;
        console.warn(`Skipping ${entityType} ${entityId} due to import error:`, error.message);
      }
    }

    const known = this.listKnownEntities();
    let pendingMissingCount = 0;
    for (const record of known) {
      const recordId = normalizeAutomationId(record.id);
      if (record.status === 'active' && !seenIds.has(recordId)) {
        if (entities.length === 0) {
          this.store.upsertAutomation(record.id, {
            missingSeenCount: 0,
          });
          continue;
        }

        const recordType = this.resolveEntityType(record);
        const existsInHa = recordType === 'script'
          ? await this.haClient.scriptExists(normalizeAutomationId(record.entityId || record.id))
          : await this.haClient.automationExists(normalizeAutomationId(record.entityId || record.id));
        if (existsInHa) {
          this.store.upsertAutomation(record.id, {
            missingSeenCount: 0,
          });
          continue;
        }

        const nextMissingCount = Number(record.missingSeenCount || 0) + 1;
        if (nextMissingCount < AUTO_QUARANTINE_MISS_THRESHOLD) {
          this.store.upsertAutomation(record.id, {
            missingSeenCount: nextMissingCount,
          });
          pendingMissingCount += 1;
          console.warn(
            `Automation ${record.id} missing in HA check ${nextMissingCount}/${AUTO_QUARANTINE_MISS_THRESHOLD}; waiting before quarantine.`
          );
          continue;
        }

        this.store.upsertAutomation(record.id, {
          status: 'quarantine',
          autoQuarantined: true,
          quarantinedAt: new Date().toISOString(),
          missingSeenCount: 0,
        });

        this.gitBackup.moveToQuarantine(record.id);
        this.store.addWarning(`${recordType === 'script' ? 'Script' : 'Automation'} ${record.id} disappeared from Home Assistant and was moved to quarantine.`);
        autoQuarantinedCount += 1;
        console.warn(`${recordType} ${record.id} auto-quarantined after ${AUTO_QUARANTINE_MISS_THRESHOLD} missing checks.`);
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

    const tracked = this.listKnownEntities();
    const activeCount = tracked.filter((entry) => entry.status === 'active').length;
    const quarantineCount = tracked.filter((entry) => entry.status === 'quarantine').length;

    console.log(
      `Import summary: discovered=${entities.length}, changed=${importedCount}, failed=${failedCount}, active=${activeCount}, quarantine=${quarantineCount}, pending_missing=${pendingMissingCount}, migrated=${migratedCount}, cleaned_legacy_quarantine=${cleanedLegacyQuarantineCount}`
    );

    return {
      importedCount,
      total: entities.length,
      failedCount,
      activeCount,
      quarantineCount,
      trackedCount: tracked.length,
      pendingMissingCount,
      migratedCount,
      cleanedLegacyQuarantineCount,
      autoCommit,
    };
  }

  listAutomations() {
    return this.listKnownEntities().filter((entry) => this.resolveEntityType(entry) === 'automation');
  }

  listScripts() {
    return this.listKnownEntities().filter((entry) => this.resolveEntityType(entry) === 'script');
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
      throw new Error('Entity does not exist in local catalog.');
    }

    const status = this.resolveYamlStatus(record);
    const yamlText = this.gitBackup.readYamlText(status, id);
    if (yamlText == null) {
      throw new Error('Backup YAML file is missing for selected automation.');
    }

    const activeRelPaths = typeof this.gitBackup.relativeYamlPaths === 'function'
      ? this.gitBackup.relativeYamlPaths('active', id)
      : [this.gitBackup.relativeYamlPath('active', id)];
    const quarantineRelPaths = typeof this.gitBackup.relativeYamlPaths === 'function'
      ? this.gitBackup.relativeYamlPaths('quarantine', id)
      : [this.gitBackup.relativeYamlPath('quarantine', id)];
    const historyRaw = this.gitBackup.listHistoryForPaths([...activeRelPaths, ...quarantineRelPaths], 80);
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

    const activeRelPaths = typeof this.gitBackup.relativeYamlPaths === 'function'
      ? this.gitBackup.relativeYamlPaths('active', id)
      : [this.gitBackup.relativeYamlPath('active', id)];
    const quarantineRelPaths = typeof this.gitBackup.relativeYamlPaths === 'function'
      ? this.gitBackup.relativeYamlPaths('quarantine', id)
      : [this.gitBackup.relativeYamlPath('quarantine', id)];

    for (const activeRelPath of activeRelPaths) {
      const activeText = this.gitBackup.readFileAtCommit(commit, activeRelPath);
      if (activeText != null) {
        return {
          commit,
          status: 'active',
          yamlText: activeText,
        };
      }
    }

    for (const quarantineRelPath of quarantineRelPaths) {
      const quarantineText = this.gitBackup.readFileAtCommit(commit, quarantineRelPath);
      if (quarantineText != null) {
        return {
          commit,
          status: 'quarantine',
          yamlText: quarantineText,
        };
      }
    }

    throw new Error('Selected commit does not contain this automation YAML.');
  }

  validateRawYaml(payload) {
    const yamlText = String(payload?.yamlText || '');
    let parsed;
    try {
      parsed = yaml.load(yamlText);
    } catch (error) {
      throw new Error(`YAML syntax error: ${error.message}`);
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Raw configuration must be a valid YAML object.');
    }

    const warnings = [];
    if (parsed.trigger != null && !Array.isArray(parsed.trigger)) {
      warnings.push('`trigger` should be an array.');
    }
    if (parsed.condition != null && !Array.isArray(parsed.condition)) {
      warnings.push('`condition` should be an array.');
    }
    if (parsed.action != null && !Array.isArray(parsed.action)) {
      warnings.push('`action` should be an array.');
    }

    return {
      valid: true,
      warnings,
    };
  }

  async updateRawConfiguration(id, payload) {
    const record = this.store.getAutomation(id);
    if (!record) {
      throw new Error('Entity does not exist in local catalog.');
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
        throw new Error('Cannot apply quarantined entity directly to HA. Restore it first.');
      }
      const targetId = record.entityId || record.id;
      const entityType = this.resolveEntityType(record);
      if (entityType === 'script') {
        await this.haClient.upsertScript(targetId, parsed);
      } else {
        await this.haClient.upsertAutomation(targetId, parsed);
      }
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
    const commitMessage = String(payload?.commitMessage || '').trim() || `feat(raw): update entity ${id}`;
    const commit = this.gitBackup.commit(commitMessage);

    return {
      id,
      status,
      commit,
    };
  }

  async updateMetadata(id, payload) {
    const record = this.store.getAutomation(id);
    if (!record) {
      throw new Error('Entity does not exist in local catalog.');
    }

    const labels = Array.isArray(payload.labels)
      ? payload.labels.map((value) => String(value).trim()).filter(Boolean)
      : [];

    const category = payload.category ? String(payload.category).trim() : '';
    const room = payload.room ? String(payload.room).trim() : '';
    const applyToHa = payload.applyToHa !== false;

    const status = this.resolveYamlStatus(record);
    let parsed = null;
    const yamlPath = this.gitBackup.yamlPath(status, id);
    if (fs.existsSync(yamlPath)) {
      try {
        parsed = yaml.load(fs.readFileSync(yamlPath, 'utf8'));
      } catch (_error) {
        parsed = null;
      }
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      const entityType = this.resolveEntityType(record);
      parsed = (
        entityType === 'script'
          ? await this.haClient.getScriptConfig(record.entityId || record.id)
          : await this.haClient.getAutomationConfig(record.entityId || record.id)
      ) || {
        alias: record.alias || id,
        ...(entityType === 'script'
          ? { sequence: [] }
          : {
              trigger: [],
              condition: [],
              action: [],
            }),
      };
    }

    parsed.category = category || null;
    parsed.labels = labels;
    parsed.metadata = {
      ...(parsed.metadata && typeof parsed.metadata === 'object' ? parsed.metadata : {}),
      category,
      labels,
      room,
    };

    if (room) {
      parsed.room = room;
    } else if (Object.prototype.hasOwnProperty.call(parsed, 'room')) {
      delete parsed.room;
    }

    if (!category && Object.prototype.hasOwnProperty.call(parsed, 'category')) {
      delete parsed.category;
    }

    const yamlHash = this.buildYamlHash(parsed);
    this.gitBackup.writeYaml(status, id, parsed);

    const updated = this.store.upsertAutomation(id, {
      category,
      labels,
      room,
      yamlHash,
      updatedAt: new Date().toISOString(),
    });

    let haApplied = false;
    let haError = '';
    if (applyToHa && record.status === 'active' && typeof this.haClient.updateAutomationMetadata === 'function') {
      const targetEntityId = record.entityId || record.id;
      try {
        await this.haClient.updateAutomationMetadata(targetEntityId, {
          category,
          labels,
          room,
        });
        haApplied = true;
      } catch (error) {
        haError = String(error?.message || 'Unknown Home Assistant metadata update error');
      }
    }

    this.gitBackup.writeMetadata(this.store.state);
    return {
      ...updated,
      haApplied,
      haError,
    };
  }

  async quarantineEntity(id, { confirmed, expectedType }) {
    if (!confirmed) {
      throw new Error('Quarantine requires confirmed=true to remove entity from Home Assistant.');
    }

    const record = this.store.getAutomation(id);
    if (!record || record.status !== 'active') {
      throw new Error('Entity is not active or does not exist.');
    }

    const entityType = this.resolveEntityType(record);
    if (expectedType && entityType !== expectedType) {
      throw new Error(`Entity is not a ${expectedType}.`);
    }

    const deleteCandidates = [
      normalizeAutomationId(record.editId),
      normalizeAutomationId(record.entityId),
      normalizeAutomationId(record.id),
    ].filter(Boolean);
    const uniqueDeleteCandidates = [...new Set(deleteCandidates)];

    let deletedFromHa = false;
    let lastDeleteError = null;

    for (const candidateId of uniqueDeleteCandidates) {
      try {
        if (entityType === 'script') {
          await this.haClient.deleteScript(candidateId);
        } else {
          await this.haClient.deleteAutomation(candidateId);
        }
        deletedFromHa = true;
        break;
      } catch (error) {
        lastDeleteError = error;
        if (!canRetryNotFoundDelete(error)) {
          throw error;
        }
      }
    }

    if (!deletedFromHa) {
      throw lastDeleteError || new Error('Failed to remove entity from Home Assistant before quarantine.');
    }

    this.gitBackup.moveToQuarantine(id);

    const updated = this.store.upsertAutomation(id, {
      status: 'quarantine',
      autoQuarantined: false,
      quarantinedAt: new Date().toISOString(),
    });

    this.gitBackup.writeMetadata(this.store.state);
    return updated;
  }

  async quarantineAutomation(id, { confirmed }) {
    return this.quarantineEntity(id, { confirmed, expectedType: 'automation' });
  }

  async quarantineScript(id, { confirmed }) {
    return this.quarantineEntity(id, { confirmed, expectedType: 'script' });
  }

  async restoreEntity(id, { expectedType } = {}) {
    const record = this.store.getAutomation(id);
    if (!record || record.status !== 'quarantine') {
      throw new Error('Entity is not in quarantine.');
    }
    const entityType = this.resolveEntityType(record);
    if (expectedType && entityType !== expectedType) {
      throw new Error(`Entity is not a ${expectedType}.`);
    }

    const quarantinePath = this.gitBackup.yamlPath('quarantine', id);
    const fs = require('fs');
    const yaml = require('js-yaml');

    if (!fs.existsSync(quarantinePath)) {
      throw new Error('Missing quarantine YAML backup for selected automation.');
    }

    const parsed = yaml.load(fs.readFileSync(quarantinePath, 'utf8'));
    if (entityType === 'script') {
      await this.haClient.upsertScript(id, parsed);
    } else {
      await this.haClient.upsertAutomation(id, parsed);
    }

    const existenceCandidates = [...new Set([
      normalizeAutomationId(record.entityId),
      normalizeAutomationId(record.id),
      normalizeAutomationId(id),
    ].filter(Boolean))];

    let restoredInHa = true;
    if (entityType === 'script' && typeof this.haClient?.scriptExists === 'function') {
      restoredInHa = false;
      for (const candidate of existenceCandidates) {
        if (await this.haClient.scriptExists(candidate)) {
          restoredInHa = true;
          break;
        }
      }
    } else if (entityType === 'automation' && typeof this.haClient?.automationExists === 'function') {
      restoredInHa = false;
      for (const candidate of existenceCandidates) {
        if (await this.haClient.automationExists(candidate)) {
          restoredInHa = true;
          break;
        }
      }
    }

    if (!restoredInHa) {
      throw new Error(`Restore verification failed: ${id} is still not present in Home Assistant.`);
    }

    this.gitBackup.moveToActive(id);
    const updated = this.store.upsertAutomation(id, {
      status: 'active',
      restoredAt: new Date().toISOString(),
      autoQuarantined: false,
    });

    this.gitBackup.writeMetadata(this.store.state);
    return updated;
  }

  async restoreAutomation(id) {
    return this.restoreEntity(id, { expectedType: 'automation' });
  }

  async restoreScript(id) {
    return this.restoreEntity(id, { expectedType: 'script' });
  }

  deleteFromQuarantine(id, { confirmed }) {
    if (!confirmed) {
      throw new Error('Permanent delete requires confirmed=true.');
    }

    const record = this.store.getAutomation(id);
    if (!record || record.status !== 'quarantine') {
      throw new Error('Entity is not in quarantine.');
    }

    this.gitBackup.deleteQuarantine(id);
    this.store.deleteAutomation(id);
    this.gitBackup.writeMetadata(this.store.state);

    return { deleted: true, id };
  }

  async buildDeviceView() {
    const output = {};
    const knownEntities = this.listKnownEntities();
    const entityById = new Map(
      knownEntities.map((entry) => [normalizeAutomationId(entry.id), entry])
    );

    const pushEntity = (deviceEntry, entityRecord) => {
      const entityId = normalizeAutomationId(entityRecord?.id);
      if (!entityId || deviceEntry.automationIds.some((entry) => entry.id === entityId)) {
        return;
      }

      deviceEntry.automationIds.push({
        id: entityId,
        entityType: this.resolveEntityType(entityRecord),
        editId: entityRecord.editId || '',
        alias: entityRecord.alias || entityId,
        status: entityRecord.status,
        haEnabled: entityRecord.haEnabled !== false,
        category: entityRecord.category || '',
        room: entityRecord.room || '',
        labels: entityRecord.labels || [],
      });
    };

    for (const record of knownEntities) {
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

      const rawRefs = [...extractDeviceRefs(parsed)];
      const scriptRefs = new Set([...extractLinkedScriptRefs(parsed)]);
      const refs = rawRefs.filter((ref) => {
        const normalized = String(ref || '').trim().toLowerCase();
        if (!normalized) {
          return false;
        }
        if (SCRIPT_ENTITY_PATTERN.test(normalized)) {
          scriptRefs.add(normalized);
          return false;
        }
        return true;
      });

      const mappedKeysForRecord = new Set();
      for (const ref of refs) {
        if (!ref) {
          continue;
        }
        let resolvedRefs = [];
        if (typeof this.haClient?.resolveDeviceReference === 'function') {
          try {
            resolvedRefs = await this.haClient.resolveDeviceReference(ref);
          } catch (_error) {
            resolvedRefs = [];
          }
        }

        const normalizedResolved = resolvedRefs.length
          ? resolvedRefs
          : [{ key: String(ref), display: String(ref) }];

        for (const resolved of normalizedResolved) {
          const key = String(resolved.key || '').trim();
          if (!key) {
            continue;
          }
          const dedupeKey = `${record.id}:${key}`;
          if (mappedKeysForRecord.has(dedupeKey)) {
            continue;
          }
          mappedKeysForRecord.add(dedupeKey);

          if (!output[key]) {
            output[key] = {
              deviceId: key,
              deviceName: String(resolved.display || key),
              sourceDeviceIds: [],
              automationIds: [],
            };
          } else {
            const resolvedName = String(resolved.display || '').trim();
            const currentName = String(output[key].deviceName || '').trim();
            if (resolvedName && (!currentName || currentName === output[key].deviceId || UUID_LIKE_PATTERN.test(currentName))) {
              output[key].deviceName = resolvedName;
            }
          }

          const sourceDeviceId = String(resolved.sourceDeviceId || '').trim();
          if (sourceDeviceId && UUID_LIKE_PATTERN.test(sourceDeviceId)) {
            output[key].sourceDeviceIds.push(sourceDeviceId);
            output[key].sourceDeviceIds = [...new Set(output[key].sourceDeviceIds)];
          }

          pushEntity(output[key], record);

          for (const linkedScriptId of scriptRefs) {
            const linkedScript = entityById.get(linkedScriptId);
            if (!linkedScript || this.resolveEntityType(linkedScript) !== 'script') {
              continue;
            }
            pushEntity(output[key], linkedScript);
          }
        }
      }
    }

    return Object.values(output)
      .map((item) => ({
        ...item,
        automationIds: item.automationIds.sort((a, b) => (a.alias || a.id).localeCompare(b.alias || b.id)),
      }))
      .sort((a, b) => {
        const countDiff = Number(b.automationIds?.length || 0) - Number(a.automationIds?.length || 0);
        if (countDiff !== 0) {
          return countDiff;
        }
        const aName = String(a.deviceName || a.deviceId || '');
        const bName = String(b.deviceName || b.deviceId || '');
        return aName.localeCompare(bName);
      });
  }

  commit(message) {
    return this.gitBackup.commit(message || 'chore: update automation backup state');
  }

  push() {
    return this.gitBackup.push();
  }

  gitStatus() {
    return {
      hasChanges: this.gitBackup.hasChanges(),
      hasCommits: typeof this.gitBackup.hasCommits === 'function'
        ? this.gitBackup.hasCommits()
        : false,
      hasPendingPush: typeof this.gitBackup.hasPendingPush === 'function'
        ? this.gitBackup.hasPendingPush()
        : false,
    };
  }

  gitDiff() {
    return {
      diff: typeof this.gitBackup.getDiff === 'function'
        ? this.gitBackup.getDiff()
        : '',
    };
  }

  gitLastCommit() {
    return {
      commit: typeof this.gitBackup.getLastCommit === 'function'
        ? this.gitBackup.getLastCommit()
        : '',
    };
  }
}

module.exports = {
  AutomationService,
  extractDeviceRefs,
  extractLinkedScriptRefs,
};
