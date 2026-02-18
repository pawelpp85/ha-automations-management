const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const yaml = require('js-yaml');
const { ensureDir, atomicWrite, removeIfExists } = require('../lib/fs-utils');

class GitBackupService {
  constructor(options, repoDir = '/data/automation_backup_repo') {
    this.options = options;
    this.repoDir = repoDir;
    this.activeDir = path.join(this.repoDir, 'automations/active');
    this.quarantineDir = path.join(this.repoDir, 'automations/quarantine');
    this.metadataDir = path.join(this.repoDir, 'metadata');
    this.ensureRepo();
  }

  gitRaw(args, envPatch = {}) {
    const env = {
      ...process.env,
      ...envPatch,
    };

    return execFileSync('git', args, {
      cwd: this.repoDir,
      env,
      encoding: 'utf8',
    });
  }

  gitRawAllowExitCodes(args, allowedExitCodes = [0], envPatch = {}) {
    const env = {
      ...process.env,
      ...envPatch,
    };

    const result = spawnSync('git', args, {
      cwd: this.repoDir,
      env,
      encoding: 'utf8',
    });

    const status = Number(result.status ?? 0);
    if (allowedExitCodes.includes(status)) {
      return result.stdout || '';
    }

    if (result.error) {
      throw result.error;
    }

    const stderr = String(result.stderr || '').trim();
    throw new Error(stderr || `Git command failed with exit code ${status}: git ${args.join(' ')}`);
  }

  git(args, envPatch = {}) {
    return this.gitRaw(args, envPatch).trim();
  }

  ensureRepo() {
    ensureDir(this.activeDir);
    ensureDir(this.quarantineDir);
    ensureDir(this.metadataDir);

    if (!fs.existsSync(path.join(this.repoDir, '.git'))) {
      try {
        execFileSync('git', ['init', '-b', 'main'], { cwd: this.repoDir });
      } catch (_error) {
        execFileSync('git', ['init'], { cwd: this.repoDir });
        try {
          this.git(['branch', '-M', 'main']);
        } catch (_renameError) {
          // Ignore if current git version cannot rename branch in this state.
        }
      }
    }

    this.git(['config', 'user.name', this.options.git_user_name]);
    this.git(['config', 'user.email', this.options.git_user_email]);

    if (this.options.remote_enabled && this.options.remote_url) {
      const existing = this.git(['remote'], {}).split('\n').filter(Boolean);
      if (!existing.includes('origin')) {
        this.git(['remote', 'add', 'origin', this.options.remote_url]);
      } else {
        this.git(['remote', 'set-url', 'origin', this.options.remote_url]);
      }
    }
  }

  normalizeId(automationId) {
    return String(automationId).replace(/[^a-zA-Z0-9_.-]/g, '_');
  }

  yamlPath(status, automationId) {
    const fileName = `${this.normalizeId(automationId)}.yaml`;
    const base = status === 'quarantine' ? this.quarantineDir : this.activeDir;
    return path.join(base, fileName);
  }

  relativeYamlPath(status, automationId) {
    return path.relative(this.repoDir, this.yamlPath(status, automationId)).split(path.sep).join('/');
  }

  fileExists(status, automationId) {
    return fs.existsSync(this.yamlPath(status, automationId));
  }

  readYamlText(status, automationId) {
    const targetPath = this.yamlPath(status, automationId);
    if (!fs.existsSync(targetPath)) {
      return null;
    }

    return fs.readFileSync(targetPath, 'utf8');
  }

  writeYamlText(status, automationId, yamlText) {
    const outputPath = this.yamlPath(status, automationId);
    const normalized = String(yamlText || '');
    atomicWrite(outputPath, normalized.endsWith('\n') ? normalized : `${normalized}\n`);
    return outputPath;
  }

  writeYaml(status, automationId, config) {
    const outputPath = this.yamlPath(status, automationId);
    const serialized = yaml.dump(config, {
      lineWidth: 120,
      noRefs: true,
      sortKeys: false,
      noCompatMode: true,
    });

    atomicWrite(outputPath, serialized);
    return outputPath;
  }

  moveToQuarantine(automationId) {
    const activePath = this.yamlPath('active', automationId);
    const quarantinePath = this.yamlPath('quarantine', automationId);

    if (fs.existsSync(activePath)) {
      ensureDir(path.dirname(quarantinePath));
      fs.renameSync(activePath, quarantinePath);
      return quarantinePath;
    }

    return null;
  }

  moveToActive(automationId) {
    const activePath = this.yamlPath('active', automationId);
    const quarantinePath = this.yamlPath('quarantine', automationId);

    if (fs.existsSync(quarantinePath)) {
      ensureDir(path.dirname(activePath));
      fs.renameSync(quarantinePath, activePath);
      return activePath;
    }

    return null;
  }

  deleteQuarantine(automationId) {
    removeIfExists(this.yamlPath('quarantine', automationId));
  }

  writeMetadata(payload) {
    atomicWrite(path.join(this.metadataDir, 'automations.json'), JSON.stringify(payload, null, 2));
  }

  listHistoryForPaths(relativePaths, limit = 40) {
    const paths = (relativePaths || []).filter(Boolean);
    if (!paths.length) {
      return [];
    }

    try {
      const raw = this.gitRaw(
        ['log', '-n', String(limit), '--pretty=format:%H%x09%cI%x09%s', '--', ...paths]
      ).trim();

      if (!raw) {
        return [];
      }

      return raw
        .split('\n')
        .map((line) => {
          const [commit = '', at = '', ...messageParts] = line.split('\t');
          return {
            commit,
            at,
            message: messageParts.join('\t'),
          };
        })
        .filter((entry) => entry.commit);
    } catch (_error) {
      return [];
    }
  }

  readFileAtCommit(commit, relativePath) {
    try {
      return this.gitRaw(['show', `${commit}:${relativePath}`]);
    } catch (_error) {
      return null;
    }
  }

  hasChanges() {
    const status = this.git(['status', '--porcelain']);
    return status.length > 0;
  }

  hasPendingPush() {
    if (!this.options.remote_enabled || !this.options.remote_url) {
      return false;
    }

    try {
      this.git(['rev-parse', '--verify', 'HEAD']);
    } catch (_error) {
      return false;
    }

    let hasUpstream = true;
    try {
      this.git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
    } catch (_error) {
      hasUpstream = false;
    }

    if (!hasUpstream) {
      return true;
    }

    try {
      const ahead = Number(this.git(['rev-list', '--count', '@{u}..HEAD']) || '0');
      return Number.isFinite(ahead) && ahead > 0;
    } catch (_error) {
      // If git cannot determine ahead/behind, keep push enabled so user can retry.
      return true;
    }
  }

  getDiff() {
    let output = '';
    let hasHead = true;

    try {
      this.git(['rev-parse', '--verify', 'HEAD']);
    } catch (_error) {
      hasHead = false;
    }

    if (hasHead) {
      output += this.gitRawAllowExitCodes(['diff', '--no-color', 'HEAD', '--', '.'], [0, 1]);
    } else {
      output += this.gitRawAllowExitCodes(['diff', '--no-color', '--', '.'], [0, 1]);
    }

    let untrackedFiles = [];
    try {
      untrackedFiles = this.git(['ls-files', '--others', '--exclude-standard'])
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
    } catch (_error) {
      untrackedFiles = [];
    }

    for (const relativePath of untrackedFiles) {
      const fileDiff = this.gitRawAllowExitCodes(
        ['diff', '--no-color', '--no-index', '--', '/dev/null', relativePath],
        [0, 1]
      );
      if (!fileDiff) {
        continue;
      }
      output += output.endsWith('\n') || output.length === 0 ? '' : '\n';
      output += fileDiff;
    }

    return String(output || '').trimEnd();
  }

  commit(message) {
    this.git(['add', '-A']);
    if (!this.hasChanges()) {
      console.log('Git backup commit skipped: no changes to commit.');
      return { created: false };
    }

    this.git(['commit', '-m', message]);
    console.log(`Git backup commit created: "${message}"`);
    return { created: true };
  }

  push() {
    if (!this.options.remote_enabled || !this.options.remote_url) {
      throw new Error('Remote push is disabled in add-on options.');
    }

    const branch = this.options.remote_branch || 'main';
    const envPatch = {};

    if (this.options.remote_auth_mode === 'ssh') {
      const keyPath = '/tmp/ha_automation_manager_remote_key';
      let keyMaterial = '';

      const rawBase64 = String(this.options.remote_ssh_key_base64 || '').trim();
      if (rawBase64) {
        try {
          const compactBase64 = rawBase64.replace(/\s+/g, '');
          keyMaterial = Buffer.from(compactBase64, 'base64').toString('utf8');
        } catch (_error) {
          throw new Error('Invalid remote_ssh_key_base64 value. Provide valid base64 encoded private key text.');
        }
      }

      if (!keyMaterial) {
        keyMaterial = String(this.options.remote_ssh_key || '');
        keyMaterial = keyMaterial.replace(/\r\n/g, '\n');
        if (keyMaterial.includes('\\n')) {
          keyMaterial = keyMaterial.replace(/\\n/g, '\n');
        }
      }

      keyMaterial = keyMaterial.trim();
      if (!keyMaterial) {
        throw new Error('SSH auth mode selected, but no SSH key provided. Set remote_ssh_key or remote_ssh_key_base64.');
      }

      if (!keyMaterial.includes('BEGIN') || !keyMaterial.includes('PRIVATE KEY')) {
        throw new Error(
          'Invalid SSH key format. Paste full private key (multiline), use escaped \\n, or set remote_ssh_key_base64.'
        );
      }

      fs.writeFileSync(keyPath, `${keyMaterial}\n`, { mode: 0o600 });
      envPatch.GIT_SSH_COMMAND = `ssh -i ${keyPath} -o StrictHostKeyChecking=no -o IdentitiesOnly=yes`;
    }

    if (this.options.remote_auth_mode === 'https' && this.options.remote_https_token) {
      const user = this.options.remote_https_username || 'token';
      const url = this.options.remote_url.replace(/^https:\/\//, `https://${encodeURIComponent(user)}:${encodeURIComponent(this.options.remote_https_token)}@`);
      this.git(['remote', 'set-url', 'origin', url]);
    }

    try {
      this.git(['rev-parse', '--verify', 'HEAD']);
    } catch (_error) {
      throw new Error('Backup repository has no commits yet. Create a commit before push.');
    }

    let currentBranch = '';
    try {
      currentBranch = this.git(['rev-parse', '--abbrev-ref', 'HEAD']);
    } catch (_error) {
      currentBranch = '';
    }

    console.log(
      `Git backup push: remote=origin url=${this.options.remote_url} local_branch=${currentBranch || 'detached'} target_branch=${branch}`
    );

    // Push from current HEAD to the configured target branch. This works even
    // when local branch is still "master" and target branch is "main".
    try {
      this.git(['push', '-u', 'origin', `HEAD:${branch}`], envPatch);
      return { pushed: true, branch, localBranch: currentBranch || null };
    } catch (error) {
      const message = String(error.message || '');
      if (message.includes('error in libcrypto') || message.includes('Load key')) {
        throw new Error(
          'SSH key could not be loaded. Use full private key text with real new lines (or escaped \\n), or use remote_ssh_key_base64, and verify key type.'
        );
      }
      if (message.includes('Permission denied (publickey)')) {
        throw new Error(
          'Permission denied by remote repository. Verify deploy key/user key has write access to target repository.'
        );
      }
      throw error;
    }
  }
}

module.exports = {
  GitBackupService,
};
