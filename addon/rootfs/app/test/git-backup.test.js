const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { GitBackupService } = require('../src/services/git-backup');

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function options() {
  return {
    git_user_name: 'Test User',
    git_user_email: 'test@example.com',
    remote_enabled: false,
    remote_url: '',
    remote_branch: 'main',
    remote_auth_mode: 'ssh',
    remote_ssh_key: '',
    remote_ssh_key_base64: '',
    remote_https_username: '',
    remote_https_token: '',
  };
}

test('GitBackupService initializes repository and writes YAML snapshots', () => {
  const repoDir = tempDir('ha-am-repo-');
  const backup = new GitBackupService(options(), repoDir);

  assert.equal(fs.existsSync(path.join(repoDir, '.git')), true);

  const activeFile = backup.writeYaml('active', 'automation.a', {
    alias: 'A',
    trigger: [],
    action: [],
  });

  assert.equal(fs.existsSync(activeFile), true);

  const moved = backup.moveToQuarantine('automation.a');
  assert.equal(Boolean(moved), true);
  assert.equal(fs.existsSync(activeFile), false);

  const restored = backup.moveToActive('automation.a');
  assert.equal(Boolean(restored), true);
  assert.equal(fs.existsSync(restored), true);
});

test('GitBackupService creates commits when changes exist', () => {
  const repoDir = tempDir('ha-am-repo-commit-');
  const backup = new GitBackupService(options(), repoDir);

  backup.writeYaml('active', 'automation.commit', {
    alias: 'Commit test',
    trigger: [],
    action: [],
  });

  const result = backup.commit('test: add automation snapshot');
  assert.equal(result.created, true);

  const noChange = backup.commit('test: noop');
  assert.equal(noChange.created, false);
});

test('GitBackupService hasPendingPush is false when remote is disabled', () => {
  const repoDir = tempDir('ha-am-repo-pending-off-');
  const backup = new GitBackupService(options(), repoDir);
  backup.writeYaml('active', 'automation.pending_off', { alias: 'Pending off', trigger: [], action: [] });
  backup.commit('test: pending off');

  assert.equal(backup.hasPendingPush(), false);
});

test('GitBackupService hasPendingPush is true when remote is enabled and commit is not pushed', () => {
  const repoDir = tempDir('ha-am-repo-pending-on-');
  const backup = new GitBackupService({
    ...options(),
    remote_enabled: true,
    remote_url: 'git@github.com:example/private.git',
  }, repoDir);
  backup.writeYaml('active', 'automation.pending_on', { alias: 'Pending on', trigger: [], action: [] });
  backup.commit('test: pending on');

  assert.equal(backup.hasPendingPush(), true);
});

test('GitBackupService getDiff returns unified patch with line changes', () => {
  const repoDir = tempDir('ha-am-repo-diff-');
  const backup = new GitBackupService(options(), repoDir);

  backup.writeYaml('active', 'automation.diff_view', {
    alias: 'Diff view',
    trigger: [],
    action: [],
  });

  const diff = backup.getDiff();
  assert.equal(typeof diff, 'string');
  assert.ok(diff.includes('diff --git'));
  assert.ok(diff.includes('automation.diff_view.yaml'));
  assert.ok(diff.includes('+alias: Diff view'));
});

test('GitBackupService rejects invalid base64 SSH key early', () => {
  const repoDir = tempDir('ha-am-repo-push-');
  const backup = new GitBackupService({
    ...options(),
    remote_enabled: true,
    remote_url: 'git@github.com:example/private.git',
    remote_auth_mode: 'ssh',
    remote_ssh_key_base64: 'not-base64***',
  }, repoDir);

  assert.throws(
    () => backup.push(),
    /Invalid SSH key format|Invalid remote_ssh_key_base64/
  );
});
