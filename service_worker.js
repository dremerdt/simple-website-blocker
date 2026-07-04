// Description: This file keeps dynamic blocking rules in sync with extension storage.
importScripts('constants.js', 'shared.js');

const RULES_START_ID = 70000;
const RULES_END_ID = RULES_START_ID + chrome.declarativeNetRequest.MAX_NUMBER_OF_DYNAMIC_RULES;

function getPresentRuleIds() {
  return new Promise(resolve => {
    chrome.declarativeNetRequest.getDynamicRules(function (oldRules) {
      resolve(oldRules.map(rule => rule.id).filter(id => id >= RULES_START_ID && id < RULES_END_ID));
    });
  });
}

function updateDynamicRules(options) {
  return new Promise(resolve => {
    chrome.declarativeNetRequest.updateDynamicRules(options, function () {
      if (chrome.runtime.lastError) {
        console.error(chrome.runtime.lastError.message);
      }

      resolve();
    });
  });
}

function getStoredBlockedWebsites() {
  return new Promise(resolve => {
    const defaults = {};
    defaults[WebsiteBlocker.STORAGE_KEY] = [];
    chrome.storage.local.get(defaults, function (data) {
      resolve(data[WebsiteBlocker.STORAGE_KEY]);
    });
  });
}

function saveBlockedWebsites(blockedWebsites) {
  return new Promise(resolve => {
    const value = {};
    value[WebsiteBlocker.STORAGE_KEY] = WebsiteBlocker.normalizeBlockedWebsites(blockedWebsites);
    chrome.storage.local.set(value, resolve);
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

function getActiveBlockedWebsites(blockedWebsites) {
  return WebsiteBlocker.normalizeBlockedWebsites(blockedWebsites)
    .filter(site => WebsiteBlocker.isEntryBlocking(site));
}

async function refreshBlockRules(blockedWebsites) {
  const oldRules = await getPresentRuleIds();
  let index = RULES_START_ID;
  const rules = getActiveBlockedWebsites(blockedWebsites)
    .slice(0, RULES_END_ID - RULES_START_ID)
    .map(site => getNewBlockRule(index++, site));

  await updateDynamicRules({
    removeRuleIds: oldRules,
    addRules: rules
  });
}

function scheduleExpirationAlarm(blockedWebsites) {
  chrome.alarms.clear(WebsiteBlocker.EXPIRATION_ALARM_NAME, function () {
    const nextExpiration = WebsiteBlocker.getNextExpiration(blockedWebsites);
    if (!nextExpiration) return;

    chrome.alarms.create(WebsiteBlocker.EXPIRATION_ALARM_NAME, {
      when: Math.max(Date.now() + 1000, nextExpiration)
    });
  });
}

async function reconcileBlockedWebsites() {
  const blockedWebsites = await getStoredBlockedWebsites();
  const expirationResult = WebsiteBlocker.expireEntries(blockedWebsites);

  if (expirationResult.changed) {
    await saveBlockedWebsites(expirationResult.entries);
  }

  await refreshBlockRules(expirationResult.entries);
  scheduleExpirationAlarm(expirationResult.entries);
}

chrome.runtime.onInstalled.addListener(function () {
  reconcileBlockedWebsites();
});

chrome.runtime.onStartup.addListener(function () {
  reconcileBlockedWebsites();
});

chrome.alarms.onAlarm.addListener(function (alarm) {
  if (alarm.name !== WebsiteBlocker.EXPIRATION_ALARM_NAME) return;
  reconcileBlockedWebsites();
});

chrome.storage.onChanged.addListener(function (changes, namespace) {
  if (namespace !== 'local') return;
  if (!changes[WebsiteBlocker.STORAGE_KEY]) return;

  const expirationResult = WebsiteBlocker.expireEntries(changes[WebsiteBlocker.STORAGE_KEY].newValue || []);
  if (expirationResult.changed) {
    saveBlockedWebsites(expirationResult.entries);
    return;
  }

  refreshBlockRules(expirationResult.entries);
  scheduleExpirationAlarm(expirationResult.entries);
});
