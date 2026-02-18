const { installConsoleTimestampPrefix } = require('./lib/logger');
installConsoleTimestampPrefix();

const path = require('path');
const express = require('express');
const { readOptions } = require('./lib/options');
const { StoreService } = require('./services/store');
const { HaClient } = require('./services/ha-client');
const { GitBackupService } = require('./services/git-backup');
const { AutomationService } = require('./services/automation-service');

const options = readOptions();
const store = new StoreService();
const haClient = new HaClient();
const gitBackup = new GitBackupService(options);
const automationService = new AutomationService({ store, haClient, gitBackup });

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '../public')));

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    version: '1.0.0b8',
    startedAt: process.uptime(),
  });
});

app.get('/api/config', (_req, res) => {
  res.json({
    version: '1.0.0b8',
    syncIntervalSeconds: options.sync_interval_seconds,
    remoteEnabled: options.remote_enabled,
  });
});

app.get('/api/automations', (_req, res) => {
  res.json({
    data: automationService.listAutomations(),
  });
});

app.get('/api/devices', (_req, res) => {
  res.json({
    data: automationService.buildDeviceView(),
  });
});

app.get('/api/warnings', (_req, res) => {
  res.json({
    data: automationService.listWarnings(),
  });
});

app.post('/api/import', async (_req, res) => {
  try {
    const result = await automationService.importFromHa({ automaticCommit: true });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/sync', async (_req, res) => {
  try {
    const result = await automationService.importFromHa({ automaticCommit: true });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/automations/:id/meta', (req, res) => {
  try {
    const updated = automationService.updateMetadata(req.params.id, req.body || {});
    res.json({ data: updated });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/automations/:id/quarantine', async (req, res) => {
  try {
    const updated = await automationService.quarantineAutomation(req.params.id, {
      confirmed: Boolean(req.body?.confirmed),
    });

    res.json({ data: updated });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/quarantine/:id/restore', async (req, res) => {
  try {
    const updated = await automationService.restoreAutomation(req.params.id);
    res.json({ data: updated });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.delete('/api/quarantine/:id', (req, res) => {
  try {
    const result = automationService.deleteFromQuarantine(req.params.id, {
      confirmed: req.query.confirmed === 'true',
    });

    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/git/commit', (req, res) => {
  try {
    const result = automationService.commit(req.body?.message);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/git/push', (_req, res) => {
  try {
    const result = automationService.push();
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

const port = 8099;
app.listen(port, async () => {
  console.log(`HA Automations Management listening on :${port}`);

  try {
    await automationService.importFromHa({ automaticCommit: true });
  } catch (error) {
    console.error('Initial import failed:', error.message);
  }

  setInterval(async () => {
    try {
      await automationService.importFromHa({ automaticCommit: true });
    } catch (error) {
      console.error('Periodic sync failed:', error.message);
    }
  }, Math.max(30, Number(options.sync_interval_seconds || 300)) * 1000);
});
