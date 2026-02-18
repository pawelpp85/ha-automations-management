const fs = require('fs');
const path = require('path');
const { ensureDir, atomicWrite } = require('../lib/fs-utils');

class StoreService {
  constructor(baseDir = '/data/ha_automation_manager') {
    this.baseDir = baseDir;
    this.statePath = path.join(baseDir, 'state.json');
    ensureDir(this.baseDir);
    this.state = this.load();
  }

  load() {
    if (!fs.existsSync(this.statePath)) {
      return {
        automations: {},
        warnings: [],
        lastSyncAt: null,
      };
    }

    try {
      return JSON.parse(fs.readFileSync(this.statePath, 'utf8'));
    } catch (error) {
      console.error('Failed to parse state file:', error.message);
      return {
        automations: {},
        warnings: [],
        lastSyncAt: null,
      };
    }
  }

  save() {
    atomicWrite(this.statePath, JSON.stringify(this.state, null, 2));
  }

  getAutomation(id) {
    return this.state.automations[id] || null;
  }

  upsertAutomation(id, patch) {
    const current = this.state.automations[id] || {
      id,
      category: '',
      labels: [],
      room: '',
      status: 'active',
    };

    this.state.automations[id] = {
      ...current,
      ...patch,
      id,
    };

    this.save();
    return this.state.automations[id];
  }

  setStatus(id, status) {
    const record = this.getAutomation(id);
    if (!record) {
      return null;
    }

    record.status = status;
    this.state.automations[id] = record;
    this.save();
    return record;
  }

  deleteAutomation(id) {
    delete this.state.automations[id];
    this.save();
  }

  listAutomations() {
    return Object.values(this.state.automations);
  }

  setLastSync(timestamp) {
    this.state.lastSyncAt = timestamp;
    this.save();
  }

  addWarning(message) {
    this.state.warnings.unshift({
      id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      message,
      createdAt: new Date().toISOString(),
    });

    this.state.warnings = this.state.warnings.slice(0, 50);
    this.save();
  }

  listWarnings() {
    return this.state.warnings;
  }

  removeWarning(id) {
    this.state.warnings = this.state.warnings.filter((entry) => entry.id !== id);
    this.save();
  }

  clearWarnings() {
    this.state.warnings = [];
    this.save();
  }
}

module.exports = {
  StoreService,
};
