function buildTimePrefix() {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  const mmm = String(now.getMilliseconds()).padStart(3, '0');
  return `[${hh}:${mm}:${ss}.${mmm}]`;
}

function installConsoleTimestampPrefix() {
  if (global.__HA_AUTOMATION_MANAGER_LOGGER_INSTALLED__) {
    return;
  }
  global.__HA_AUTOMATION_MANAGER_LOGGER_INSTALLED__ = true;

  ['log', 'info', 'warn', 'error', 'debug'].forEach((method) => {
    const original = console[method].bind(console);
    console[method] = (...args) => {
      const prefix = buildTimePrefix();
      if (args.length === 0) {
        original(prefix);
        return;
      }
      if (typeof args[0] === 'string') {
        original(`${prefix} ${args[0]}`, ...args.slice(1));
        return;
      }
      original(prefix, ...args);
    };
  });
}

module.exports = {
  installConsoleTimestampPrefix,
};
