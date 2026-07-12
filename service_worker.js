// Description: This file keeps dynamic blocking rules in sync with extension storage.
importScripts('constants.js', 'shared.js');

const RULES_START_ID = 70000;
const RULES_END_ID = RULES_START_ID + chrome.declarativeNetRequest.MAX_NUMBER_OF_DYNAMIC_RULES;
let reconciliationPromise = null;
let reconciliationRequested = false;

function getPresentRuleIds() {
  return new Promise((resolve, reject) => {
    chrome.declarativeNetRequest.getDynamicRules(function (oldRules) {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      resolve(oldRules.map(rule => rule.id).filter(id => id >= RULES_START_ID && id < RULES_END_ID));
    });
  });
}

function updateDynamicRules(options) {
  return new Promise((resolve, reject) => {
    chrome.declarativeNetRequest.updateDynamicRules(options, function () {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      resolve();
    });
  });
}

function getStoredData() {
  return new Promise((resolve, reject) => {
    const defaults = {};
    defaults[WebsiteBlocker.STORAGE_KEY] = [];
    defaults[WebsiteBlocker.SCHEDULES_STORAGE_KEY] = [];
    chrome.storage.local.get(defaults, function (data) {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      resolve({
        blockedWebsites: data[WebsiteBlocker.STORAGE_KEY],
        schedules: WebsiteBlocker.normalizeStoredSchedules(data[WebsiteBlocker.SCHEDULES_STORAGE_KEY])
      });
    });
  });
}

function saveBlockedWebsites(blockedWebsites) {
  return new Promise((resolve, reject) => {
    const value = {};
    value[WebsiteBlocker.STORAGE_KEY] = WebsiteBlocker.normalizeBlockedWebsites(blockedWebsites);
    chrome.storage.local.set(value, function () {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      resolve();
    });
  });
}

function getNewBlockRule(id, site) {
  return {
    id,
    priority: 1,
    action: {
      type: 'block'
    },
    condition: WebsiteBlocker.getDnrCondition(site)
  };
}

function getActiveBlockedWebsites(blockedWebsites, schedules) {
  return WebsiteBlocker.hydrateEntriesWithSchedules(blockedWebsites, schedules)
    .filter(site => WebsiteBlocker.isEntryBlocking(site));
}

async function refreshBlockRules(blockedWebsites, schedules) {
  const oldRules = await getPresentRuleIds();
  const activeWebsites = getActiveBlockedWebsites(blockedWebsites, schedules);
  const maximumRules = RULES_END_ID - RULES_START_ID;
  const maximumRegexRules = chrome.declarativeNetRequest.MAX_NUMBER_OF_REGEX_RULES || 1000;
  const regexRuleCount = activeWebsites.filter(site => site.scope === WEBSITE_BLOCK_SCOPE.URL).length;

  if (activeWebsites.length > maximumRules) {
    throw new Error(`The active block limit of ${maximumRules} has been reached.`);
  }

  if (regexRuleCount > maximumRegexRules) {
    throw new Error(`The URL-specific block limit of ${maximumRegexRules} has been reached.`);
  }

  let index = RULES_START_ID;
  const rules = activeWebsites.map(site => getNewBlockRule(index++, site));

  await updateDynamicRules({
    removeRuleIds: oldRules,
    addRules: rules
  });
}

function scheduleRuleRefreshAlarm(blockedWebsites, schedules) {
  return new Promise(resolve => {
    chrome.alarms.clear(WebsiteBlocker.RULE_REFRESH_ALARM_NAME, function () {
      const hydratedWebsites = WebsiteBlocker.hydrateEntriesWithSchedules(blockedWebsites, schedules);
      const nextRefresh = WebsiteBlocker.getNextRuleRefreshTime(hydratedWebsites);
      if (nextRefresh) {
        chrome.alarms.create(WebsiteBlocker.RULE_REFRESH_ALARM_NAME, {
          when: Math.max(Date.now() + 1000, nextRefresh)
        });
      }

      resolve();
    });
  });
}

async function reconcileBlockedWebsites() {
  const storedData = await getStoredData();
  const expirationResult = WebsiteBlocker.expireEntries(storedData.blockedWebsites);

  if (expirationResult.changed) {
    await saveBlockedWebsites(expirationResult.entries);
  }

  await refreshBlockRules(expirationResult.entries, storedData.schedules);
  await scheduleRuleRefreshAlarm(expirationResult.entries, storedData.schedules);
}

function requestReconciliation() {
  reconciliationRequested = true;
  if (reconciliationPromise) return reconciliationPromise;

  reconciliationPromise = (async function () {
    while (reconciliationRequested) {
      reconciliationRequested = false;
      await reconcileBlockedWebsites();
    }
  })().finally(function () {
    reconciliationPromise = null;
  });

  return reconciliationPromise;
}

function reconcileFromEvent() {
  requestReconciliation().catch(function (error) {
    console.error(error.message);
  });
}

chrome.runtime.onInstalled.addListener(function () {
  reconcileFromEvent();
});

chrome.runtime.onStartup.addListener(function () {
  reconcileFromEvent();
});

chrome.alarms.onAlarm.addListener(function (alarm) {
  if (alarm.name !== WebsiteBlocker.RULE_REFRESH_ALARM_NAME) return;
  reconcileFromEvent();
});

chrome.storage.onChanged.addListener(function (changes, namespace) {
  if (namespace !== 'local') return;
  if (!changes[WebsiteBlocker.STORAGE_KEY] && !changes[WebsiteBlocker.SCHEDULES_STORAGE_KEY]) return;

  reconcileFromEvent();
});

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (!message || message.type !== WebsiteBlocker.RULE_RECONCILE_MESSAGE) return false;

  requestReconciliation().then(function () {
    sendResponse({ ok: true });
  }).catch(function (error) {
    sendResponse({ ok: false, error: error.message });
  });

  return true;
});
