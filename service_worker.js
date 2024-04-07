// Description: This file contains the service worker code that listens for changes in the blocked websites list and updates the rules accordingly.
RULES_START_ID = 70000;
RULES_END_ID = RULES_START_ID + chrome.declarativeNetRequest.MAX_NUMBER_OF_DYNAMIC_RULES;

async function getPresentRuleIds() {
  const oldRules = await chrome.declarativeNetRequest.getDynamicRules();
  return oldRules.map(rule => rule.id).filter(id => id >= RULES_START_ID && id < RULES_END_ID);
}

function getUrlMatchPattern(site) {
  // site is hostname, match all urls with this hostname
  return `||${site}^`;
}

function getNewBlockRule(id, site) {
  return {
    id,
    priority: 1,
    action: {
      type: "block"
    },
    condition: {
      urlFilter: getUrlMatchPattern(site.hostname), 
      resourceTypes: ["main_frame"]
    }
  };
}

chrome.runtime.onInstalled.addListener(async () => {
  chrome.storage.local.set({ blockedWebsites: [] });

  const oldRules = await getPresentRuleIds();
  chrome.storage.local.get({ blockedWebsites: [] }, function (data) {
    let blockedWebsites = data.blockedWebsites.filter(site => site.status === /*WEBISTE_BLOCK_STATUS.ACTIVE*/ 0);
    let index = RULES_START_ID;
    let rules = blockedWebsites.map(site => getNewBlockRule(index++, site));
    chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: oldRules,
      addRules: rules
    });
  });
});

// Listen for changes in blocked websites and update rules accordingly
chrome.storage.onChanged.addListener(async (changes, namespace) => {
  if (namespace !== "local") return;
  let rules = [];
  const oldRules = await getPresentRuleIds();
  let index = RULES_START_ID;
  for (let [key, { oldValue, newValue }] of Object.entries(changes)) {
    if (key !== "blockedWebsites") continue;
    for (let site of newValue) {
      if (site.hostname === "" || site.status !== /*WEBISTE_BLOCK_STATUS.ACTIVE*/ 0) continue;
      rules.push(getNewBlockRule(index++, site));
    }
  }
  chrome.declarativeNetRequest.updateDynamicRules({
    addRules: rules,
    removeRuleIds: oldRules
  });
});
