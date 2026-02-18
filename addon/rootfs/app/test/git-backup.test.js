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
