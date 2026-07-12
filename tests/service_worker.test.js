const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function createEvent() {
  const listeners = [];
  return {
    listeners,
    addListener(listener) {
      listeners.push(listener);
    }
  };
}

function createWorker(options = {}) {
  const events = {
    installed: createEvent(),
    startup: createEvent(),
    alarm: createEvent(),
    storageChanged: createEvent(),
    message: createEvent()
  };
  const storage = {
    blockedWebsites: [],
    blockSchedules: []
  };
  let currentRules = [];
  let activeUpdates = 0;
  let maximumConcurrentUpdates = 0;
  let updateCalls = 0;

  const chrome = {
    runtime: {
      lastError: null,
      onInstalled: events.installed,
      onStartup: events.startup,
      onMessage: events.message
    },
    declarativeNetRequest: {
      MAX_NUMBER_OF_DYNAMIC_RULES: 30000,
      getDynamicRules(callback) {
        setImmediate(() => callback(currentRules));
      },
      updateDynamicRules(update, callback) {
        updateCalls++;
        activeUpdates++;
        maximumConcurrentUpdates = Math.max(maximumConcurrentUpdates, activeUpdates);
        setTimeout(() => {
          if (options.failRuleUpdate) {
            chrome.runtime.lastError = { message: 'DNR update failed' };
          } else {
            const removedIds = new Set(update.removeRuleIds || []);
            currentRules = currentRules.filter(rule => !removedIds.has(rule.id));
            currentRules.push(...(update.addRules || []));
          }

          activeUpdates--;
          callback();
          chrome.runtime.lastError = null;
        }, 5);
      }
    },
    storage: {
      local: {
        get(defaults, callback) {
          setImmediate(() => callback({ ...defaults, ...storage }));
        },
        set(value, callback) {
          Object.assign(storage, value);
          setImmediate(callback);
        }
      },
      onChanged: events.storageChanged
    },
    alarms: {
      onAlarm: events.alarm,
      clear(name, callback) {
        setImmediate(callback);
      },
      create() {}
    }
  };

  const context = vm.createContext({
    URL,
    crypto,
    Date,
    Math,
    Promise,
    console,
    setImmediate,
    setTimeout,
    chrome
  });
  context.importScripts = function (...files) {
    files.forEach(file => {
      vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context);
    });
  };
  vm.runInContext(fs.readFileSync(path.join(root, 'service_worker.js'), 'utf8'), context);

  return {
    events,
    getMaximumConcurrentUpdates: () => maximumConcurrentUpdates,
    getUpdateCalls: () => updateCalls
  };
}

function sendReconcileMessage(worker) {
  return new Promise(resolve => {
    const listener = worker.events.message.listeners[0];
    const keepChannelOpen = listener(
      { type: 'website-blocker-reconcile-rules' },
      {},
      resolve
    );
    assert.equal(keepChannelOpen, true);
  });
}

test('coalesces rapid reconciliation requests without overlapping DNR updates', async () => {
  const worker = createWorker();
  const storageListener = worker.events.storageChanged.listeners[0];

  storageListener({ blockedWebsites: { newValue: [] } }, 'local');
  storageListener({ blockSchedules: { newValue: [] } }, 'local');
  const response = await sendReconcileMessage(worker);

  assert.equal(response.ok, true);
  assert.equal(worker.getMaximumConcurrentUpdates(), 1);
  assert.ok(worker.getUpdateCalls() >= 1);
});

test('returns DNR update failures to the message caller', async () => {
  const worker = createWorker({ failRuleUpdate: true });

  const response = await sendReconcileMessage(worker);

  assert.equal(response.ok, false);
  assert.equal(response.error, 'DNR update failed');
});
