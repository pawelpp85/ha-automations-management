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
let gitBackup = null;
let automationService = null;
let startupState = {
  serviceReady: false,
  serviceInitializing: false,
  initialImportRunning: false,
  initialImportCompleted: false,
  initError: '',
};

function getAutomationServiceOrReply(res) {
  if (!automationService) {
    res.status(503).json({
      error: 'Service is still initializing. Try again in a few seconds.',
      startup: startupState,
    });
    return null;
  }

  return automationService;
}

function initializeServices() {
  if (automationService || startupState.serviceInitializing) {
    return;
  }

  startupState.serviceInitializing = true;
  startupState.initError = '';

  try {
    gitBackup = new GitBackupService(options);
    automationService = new AutomationService({ store, haClient, gitBackup });
    startupState.serviceReady = true;
  } catch (error) {
    startupState.initError = String(error?.message || 'Unknown initialization error');
    startupState.serviceReady = false;
    console.error('Service initialization failed:', startupState.initError);
  } finally {
    startupState.serviceInitializing = false;
  }
}

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '../public')));

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    version: '1.0.0b21',
    startedAt: process.uptime(),
    startup: startupState,
  });
});

app.get('/api/config', (_req, res) => {
  res.json({
    version: '1.0.0b21',
    syncIntervalSeconds: options.sync_interval_seconds,
    remoteEnabled: options.remote_enabled,
  });
});

app.get('/api/automations', (_req, res) => {
  const service = getAutomationServiceOrReply(res);
  if (!service) return;

  res.json({
    data: service.listAutomations(),
  });
});

app.get('/api/scripts', (_req, res) => {
  const service = getAutomationServiceOrReply(res);
  if (!service) return;

  res.json({
    data: service.listScripts(),
  });
});

app.get('/api/devices', async (_req, res) => {
  const service = getAutomationServiceOrReply(res);
  if (!service) return;

  try {
    const data = await service.buildDeviceView();
    res.json({ data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/warnings', (_req, res) => {
  const service = getAutomationServiceOrReply(res);
  if (!service) return;

  res.json({
    data: service.listWarnings(),
  });
});

app.delete('/api/warnings/:id', (req, res) => {
  const service = getAutomationServiceOrReply(res);
  if (!service) return;

  try {
    const data = service.clearWarning(req.params.id);
    res.json(data);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.delete('/api/warnings', (_req, res) => {
  const service = getAutomationServiceOrReply(res);
  if (!service) return;

  try {
    const data = service.clearWarnings();
    res.json(data);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/raw/:id', (req, res) => {
  const service = getAutomationServiceOrReply(res);
  if (!service) return;

  try {
    const data = service.getRawConfiguration(req.params.id);
    res.json({ data });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/raw/:id/history/:commit', (req, res) => {
  const service = getAutomationServiceOrReply(res);
  if (!service) return;

  try {
    const data = service.getRawConfigurationVersion(req.params.id, req.params.commit);
    res.json({ data });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/raw/validate', (req, res) => {
  const service = getAutomationServiceOrReply(res);
  if (!service) return;

  try {
    const data = service.validateRawYaml(req.body || {});
    res.json({ data });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/raw/:id', async (req, res) => {
  const service = getAutomationServiceOrReply(res);
  if (!service) return;

  try {
    const data = await service.updateRawConfiguration(req.params.id, req.body || {});
    res.json({ data });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/import', async (_req, res) => {
  const service = getAutomationServiceOrReply(res);
  if (!service) return;

  try {
    const result = await service.importFromHa({ automaticCommit: false });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/sync', async (_req, res) => {
  const service = getAutomationServiceOrReply(res);
  if (!service) return;

  try {
    const result = await service.importFromHa({ automaticCommit: true });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/automations/:id/meta', async (req, res) => {
  const service = getAutomationServiceOrReply(res);
  if (!service) return;

  try {
    const updated = await service.updateMetadata(req.params.id, req.body || {});
    res.json({ data: updated });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/scripts/:id/meta', async (req, res) => {
  const service = getAutomationServiceOrReply(res);
  if (!service) return;

  try {
    const updated = await service.updateMetadata(req.params.id, req.body || {});
    res.json({ data: updated });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/automations/:id/quarantine', async (req, res) => {
  const service = getAutomationServiceOrReply(res);
  if (!service) return;

  try {
    const updated = await service.quarantineAutomation(req.params.id, {
      confirmed: Boolean(req.body?.confirmed),
    });

    res.json({ data: updated });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/scripts/:id/quarantine', async (req, res) => {
  const service = getAutomationServiceOrReply(res);
  if (!service) return;

  try {
    const updated = await service.quarantineScript(req.params.id, {
      confirmed: Boolean(req.body?.confirmed),
    });

    res.json({ data: updated });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/quarantine/:id/restore', async (req, res) => {
  const service = getAutomationServiceOrReply(res);
  if (!service) return;

  try {
    const updated = await service.restoreEntity(req.params.id);
    res.json({ data: updated });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.delete('/api/quarantine/:id', (req, res) => {
  const service = getAutomationServiceOrReply(res);
  if (!service) return;

  try {
    const result = service.deleteFromQuarantine(req.params.id, {
      confirmed: req.query.confirmed === 'true',
    });

    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/git/commit', (req, res) => {
  const service = getAutomationServiceOrReply(res);
  if (!service) return;

  try {
    const result = service.commit(req.body?.message);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/git/status', (_req, res) => {
  const service = getAutomationServiceOrReply(res);
  if (!service) return;

  try {
    const result = service.gitStatus();
    res.json({ data: result });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/git/push', (_req, res) => {
  const service = getAutomationServiceOrReply(res);
  if (!service) return;

  try {
    const result = service.push();
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
  initializeServices();
  if (!automationService) {
    return;
  }

  startupState.initialImportRunning = true;
  (async () => {
    try {
      await automationService.importFromHa({ automaticCommit: true });
    } catch (error) {
      console.error('Initial import failed:', error.message);
    } finally {
      startupState.initialImportRunning = false;
      startupState.initialImportCompleted = true;
    }
  })();

  setInterval(async () => {
    if (!automationService) {
      initializeServices();
      if (!automationService) {
        return;
      }
    }

    try {
      await automationService.importFromHa({ automaticCommit: true });
    } catch (error) {
      console.error('Periodic sync failed:', error.message);
    }
  }, Math.max(30, Number(options.sync_interval_seconds || 300)) * 1000);
});
