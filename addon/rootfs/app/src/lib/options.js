const fs = require('fs');

const DEFAULTS = {
  sync_interval_seconds: 300,
  remote_enabled: false,
  remote_url: '',
  remote_branch: 'main',
  remote_auth_mode: 'ssh',
  remote_ssh_key: '',
  remote_ssh_key_base64: '',
  remote_https_username: '',
  remote_https_token: '',
  git_user_name: 'HA Automation Manager',
  git_user_email: 'ha-automation-manager@local',
};

function readOptions() {
  const file = process.env.ADDON_OPTIONS_FILE || '/data/options.json';
  if (!fs.existsSync(file)) {
    return { ...DEFAULTS };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { ...DEFAULTS, ...parsed };
  } catch (error) {
    console.error(`Failed to parse options from ${file}:`, error.message);
    return { ...DEFAULTS };
  }
}

module.exports = {
  readOptions,
};
