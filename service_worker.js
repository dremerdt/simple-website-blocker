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

function getStoredData() {
  return new Promise(resolve => {
    const defaults = {};
    defaults[WebsiteBlocker.STORAGE_KEY] = [];
    defaults[WebsiteBlocker.SCHEDULES_STORAGE_KEY] = [];
    chrome.storage.local.get(defaults, function (data) {
      resolve({
        blockedWebsites: data[WebsiteBlocker.STORAGE_KEY],
        schedules: WebsiteBlocker.normalizeStoredSchedules(data[WebsiteBlocker.SCHEDULES_STORAGE_KEY])
      });
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

function getActiveBlockedWebsites(blockedWebsites, schedules) {
  return WebsiteBlocker.hydrateEntriesWithSchedules(blockedWebsites, schedules)
    .filter(site => WebsiteBlocker.isEntryBlocking(site));
}

async function refreshBlockRules(blockedWebsites, schedules) {
  const oldRules = await getPresentRuleIds();
  let index = RULES_START_ID;
  const rules = getActiveBlockedWebsites(blockedWebsites, schedules)
    .slice(0, RULES_END_ID - RULES_START_ID)
    .map(site => getNewBlockRule(index++, site));

  await updateDynamicRules({
    removeRuleIds: oldRules,
    addRules: rules
  });
}

function scheduleRuleRefreshAlarm(blockedWebsites, schedules) {
  chrome.alarms.clear(WebsiteBlocker.RULE_REFRESH_ALARM_NAME, function () {
    const hydratedWebsites = WebsiteBlocker.hydrateEntriesWithSchedules(blockedWebsites, schedules);
    const nextRefresh = WebsiteBlocker.getNextRuleRefreshTime(hydratedWebsites);
    if (!nextRefresh) return;

    chrome.alarms.create(WebsiteBlocker.RULE_REFRESH_ALARM_NAME, {
      when: Math.max(Date.now() + 1000, nextRefresh)
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
  scheduleRuleRefreshAlarm(expirationResult.entries, storedData.schedules);
}

chrome.runtime.onInstalled.addListener(function () {
  reconcileBlockedWebsites();
});

chrome.runtime.onStartup.addListener(function () {
  reconcileBlockedWebsites();
});

chrome.alarms.onAlarm.addListener(function (alarm) {
  if (alarm.name !== WebsiteBlocker.RULE_REFRESH_ALARM_NAME) return;
  reconcileBlockedWebsites();
});

chrome.storage.onChanged.addListener(function (changes, namespace) {
  if (namespace !== 'local') return;
  if (!changes[WebsiteBlocker.STORAGE_KEY] && !changes[WebsiteBlocker.SCHEDULES_STORAGE_KEY]) return;

  reconcileBlockedWebsites();
});
