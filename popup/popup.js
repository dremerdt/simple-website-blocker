// Description: This file contains the logic for the popup.html page.
document.addEventListener('DOMContentLoaded', function () {
  const refs = {
    websiteInput: document.getElementById('websiteUrl'),
    blockButton: document.getElementById('blockButton'),
    unblockButton: document.getElementById('unblockButton'),
    clearAllBlocked: document.getElementById('clearAllBlocked'),
    showBlockedButton: document.getElementById('showBlockedButton'),
    moreButton: document.getElementById('moreButton'),
    blockedPanel: document.getElementById('blockedWebsites'),
    blockedList: document.getElementById('blockedWebsitesList'),
    blockTypeRadios: document.querySelectorAll('input[name="blockTypeRadio"]'),
    blockScopeRadios: document.querySelectorAll('input[name="blockScopeRadio"]'),
    durationPanel: document.getElementById('blockConfigurationTemporary'),
    durationInput: document.getElementById('blockDuration'),
    durationUnit: document.getElementById('blockDurationUnit'),
    schedulePanel: document.getElementById('blockConfigurationSchedule'),
    scheduleSelect: document.getElementById('scheduleSelect'),
    openManageButton: document.getElementById('openManageButton')
  };

  const state = {
    activeHostname: '',
    activeUrl: '',
    lastPrefill: '',
    schedules: []
  };

  refs.blockButton.addEventListener('click', function () {
    const type = getSelectedBlockType();
    const durationMs = type === WEBSITE_BLOCK_TYPE.TEMPORARY
      ? WebsiteBlocker.getDurationMs(refs.durationInput.value, refs.durationUnit.value)
      : 0;
    const schedule = type === WEBSITE_BLOCK_TYPE.SCHEDULED
      ? getSelectedScheduleDefinition(refs, state)
      : null;

    if (type === WEBSITE_BLOCK_TYPE.SCHEDULED && !schedule) {
      showInfoMessage('Create or select a schedule in Manage first.', false);
      return;
    }

    const entry = WebsiteBlocker.createEntry(refs.websiteInput.value, {
      scope: getSelectedBlockScope(),
      type,
      status: WEBSITE_BLOCK_STATUS.ACTIVE,
      durationMs,
      scheduleId: schedule ? schedule.id : '',
      scheduleName: schedule ? schedule.name : ''
    });

    if (!entry) {
      showInfoMessage('Enter a valid website, duration, or schedule.', false);
      return;
    }

    readBlockedWebsites(function (blockedWebsites) {
      const nextBlockedWebsites = WebsiteBlocker.upsertEntry(blockedWebsites, entry);
      saveBlockedWebsites(nextBlockedWebsites, function () {
        refs.websiteInput.value = WebsiteBlocker.getDisplayTarget(entry);
        state.lastPrefill = refs.websiteInput.value;
        const hydratedEntry = WebsiteBlocker.hydrateEntrySchedule(entry, state.schedules);
        renderBlockedList(nextBlockedWebsites, refs, state);
        updateActiveBlockInfo(refs, state);
        if (WebsiteBlocker.isEntryBlocking(hydratedEntry)) {
          refreshActiveTab();
        }
      });
    });
  });

  refs.unblockButton.addEventListener('click', function () {
    const blockInput = WebsiteBlocker.normalizeBlockInput(refs.websiteInput.value, getSelectedBlockScope());
    if (!blockInput) {
      showInfoMessage('Enter a valid website.', false);
      return;
    }

    readBlockedWebsites(function (blockedWebsites) {
      let nextBlockedWebsites = WebsiteBlocker.removeEntry(blockedWebsites, blockInput);
      if (nextBlockedWebsites.length === blockedWebsites.length) {
        const hydratedWebsites = WebsiteBlocker.hydrateEntriesWithSchedules(blockedWebsites, state.schedules);
        const matchingEntry = hydratedWebsites.find(site =>
          getCurrentCandidateInputs(refs, state).some(input => WebsiteBlocker.doesEntryMatchInput(site, input))
        );

        if (matchingEntry) {
          nextBlockedWebsites = WebsiteBlocker.removeEntry(blockedWebsites, matchingEntry);
        }
      }

      if (nextBlockedWebsites.length === blockedWebsites.length) {
        showInfoMessage('No matching blocked entry.', false);
        return;
      }

      saveBlockedWebsites(nextBlockedWebsites, function () {
        hideInfoWebsiteBlocked(true);
        renderBlockedList(nextBlockedWebsites, refs, state);
      });
    });
  });

  refs.clearAllBlocked.addEventListener('click', function () {
    saveBlockedWebsites([], function () {
      hideInfoWebsiteBlocked(true);
      renderBlockedList([], refs, state);
      toggleWebsitesList(false, refs);
    });
  });

  refs.moreButton.addEventListener('click', function () {
    toggleConfigurationBlock();
  });

  refs.openManageButton.addEventListener('click', function () {
    chrome.runtime.openOptionsPage();
  });

  refs.showBlockedButton.addEventListener('click', function () {
    readBlockedWebsites(function (blockedWebsites) {
      renderBlockedList(blockedWebsites, refs, state);
      toggleWebsitesList(undefined, refs);
    });
  });

  refs.websiteInput.addEventListener('input', function () {
    updateActiveBlockInfo(refs, state);
  });

  refs.blockTypeRadios.forEach(radio => radio.addEventListener('change', function () {
    updateBlockConfigurationVisibility(refs);
  }));

  refs.blockScopeRadios.forEach(radio => radio.addEventListener('change', function () {
    updateInputForSelectedScope(refs, state);
    updateActiveBlockInfo(refs, state);
  }));

  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    const activeTab = tabs[0];
    if (activeTab && activeTab.url) {
      const parsed = WebsiteBlocker.parseHttpInput(activeTab.url);
      if (parsed) {
        state.activeHostname = parsed.hostname;
        state.activeUrl = parsed.url;
        refs.websiteInput.value = parsed.hostname;
        state.lastPrefill = parsed.hostname;
      }
    }

    updateActiveBlockInfo(refs, state);
  });

  readSchedules(function (schedules) {
    state.schedules = schedules;
    renderScheduleOptions(refs, state);
    updateActiveBlockInfo(refs, state);
  });

  updateBlockConfigurationVisibility(refs);
  updateInputPlaceholder(refs);
});

function readBlockedWebsites(callback) {
  const defaults = {};
  defaults[WebsiteBlocker.STORAGE_KEY] = [];

  chrome.storage.local.get(defaults, function (data) {
    const expirationResult = WebsiteBlocker.expireEntries(data[WebsiteBlocker.STORAGE_KEY]);
    if (expirationResult.changed) {
      saveBlockedWebsites(expirationResult.entries, function () {
        callback(expirationResult.entries);
      });
      return;
    }

    callback(expirationResult.entries);
  });
}

function saveBlockedWebsites(blockedWebsites, callback) {
  const value = {};
  value[WebsiteBlocker.STORAGE_KEY] = WebsiteBlocker.normalizeBlockedWebsites(blockedWebsites);
  chrome.storage.local.set(value, callback);
}

function readSchedules(callback) {
  const defaults = {};
  defaults[WebsiteBlocker.SCHEDULES_STORAGE_KEY] = [];

  chrome.storage.local.get(defaults, function (data) {
    callback(WebsiteBlocker.normalizeStoredSchedules(data[WebsiteBlocker.SCHEDULES_STORAGE_KEY]));
  });
}

function renderBlockedList(blockedWebsites, refs, state) {
  const hydratedWebsites = WebsiteBlocker.hydrateEntriesWithSchedules(blockedWebsites, state.schedules);
  refs.blockedList.innerHTML = '';

  if (hydratedWebsites.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty-list';
    li.textContent = 'No blocked websites.';
    refs.blockedList.appendChild(li);
    return;
  }

  for (const site of hydratedWebsites) {
    const li = document.createElement('li');
    li.className = 'blocked-item';
    if (!WebsiteBlocker.isEntryBlocking(site)) {
      li.classList.add('inactive');
    }

    const details = document.createElement('div');
    details.className = 'blocked-details';

    const target = document.createElement('span');
    target.className = 'blocked-target';
    target.textContent = WebsiteBlocker.getDisplayTarget(site);

    const meta = document.createElement('span');
    meta.className = 'blocked-meta';
    meta.textContent = getEntryMeta(site);

    details.appendChild(target);
    details.appendChild(meta);

    const actions = document.createElement('div');
    actions.className = 'blocked-actions';

    const toggleButton = document.createElement('button');
    toggleButton.type = 'button';
    toggleButton.textContent = getToggleButtonText(site);
    toggleButton.addEventListener('click', function () {
      toggleWebsiteBlockStatus(site.id, refs, state);
    });

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.textContent = 'Delete';
    deleteButton.addEventListener('click', function () {
      deleteWebsiteBlock(site.id, refs, state);
    });

    actions.appendChild(toggleButton);
    actions.appendChild(deleteButton);
    li.appendChild(details);
    li.appendChild(actions);
    refs.blockedList.appendChild(li);
  }
}

function getEntryMeta(site) {
  const expiresText = WebsiteBlocker.formatExpiresAt(site);
  const parts = [
    WebsiteBlocker.getScopeText(site),
    WebsiteBlocker.getTypeText(site),
    WebsiteBlocker.getStatusText(site)
  ];

  if (expiresText) {
    parts.push(expiresText);
  }

  if (site.type === WEBSITE_BLOCK_TYPE.SCHEDULED) {
    parts.push(site.scheduleName || 'Missing schedule');
  }

  return parts.join(' | ');
}

function getToggleButtonText(site) {
  if (WebsiteBlocker.isExpiredEntry(site)) return 'Make Permanent';
  return site.status === WEBSITE_BLOCK_STATUS.ACTIVE ? 'Pause' : 'Resume';
}

function toggleWebsiteBlockStatus(id, refs, state) {
  readBlockedWebsites(function (blockedWebsites) {
    const nextBlockedWebsites = blockedWebsites.map(site => {
      if (site.id !== id) return site;

      if (WebsiteBlocker.isExpiredEntry(site)) {
        return {
          ...site,
          status: WEBSITE_BLOCK_STATUS.ACTIVE,
          type: WEBSITE_BLOCK_TYPE.PERMANENT,
          expiresAt: null,
          scheduleId: '',
          scheduleName: '',
          schedule: null,
          updatedAt: Date.now()
        };
      }

      return {
        ...site,
        status: site.status === WEBSITE_BLOCK_STATUS.ACTIVE
          ? WEBSITE_BLOCK_STATUS.INACTIVE
          : WEBSITE_BLOCK_STATUS.ACTIVE,
        updatedAt: Date.now()
      };
    });

    saveBlockedWebsites(nextBlockedWebsites, function () {
      renderBlockedList(nextBlockedWebsites, refs, state);
      updateActiveBlockInfo(refs, state);
      refreshActiveTab();
    });
  });
}

function deleteWebsiteBlock(id, refs, state) {
  readBlockedWebsites(function (blockedWebsites) {
    const nextBlockedWebsites = blockedWebsites.filter(site => site.id !== id);
    saveBlockedWebsites(nextBlockedWebsites, function () {
      renderBlockedList(nextBlockedWebsites, refs, state);
      updateActiveBlockInfo(refs, state);
      refreshActiveTab();
    });
  });
}

function updateActiveBlockInfo(refs, state) {
  const candidateInputs = getCurrentCandidateInputs(refs, state);
  if (candidateInputs.length === 0) {
    hideInfoWebsiteBlocked();
    return;
  }

  readBlockedWebsites(function (blockedWebsites) {
    const hydratedWebsites = WebsiteBlocker.hydrateEntriesWithSchedules(blockedWebsites, state.schedules);
    const isBlocked = hydratedWebsites.some(site =>
      candidateInputs.some(input => WebsiteBlocker.doesEntryMatchInput(site, input))
    );

    if (isBlocked) {
      showInfoWebsiteBlocked();
    } else {
      hideInfoWebsiteBlocked();
    }
  });
}

function getCurrentCandidateInputs(refs, state) {
  const inputValue = refs.websiteInput.value.trim();
  const candidateInputs = inputValue === '' ? [] : [inputValue];
  if (inputValue !== '' && inputValue === state.lastPrefill && state.activeUrl) {
    candidateInputs.push(state.activeUrl);
  }

  return candidateInputs;
}

function getSelectedBlockScope() {
  const selected = document.querySelector('input[name="blockScopeRadio"]:checked');
  return selected ? selected.value : WEBSITE_BLOCK_SCOPE.DOMAIN;
}

function getSelectedBlockType() {
  const selected = document.querySelector('input[name="blockTypeRadio"]:checked');
  return selected ? Number(selected.value) : WEBSITE_BLOCK_TYPE.PERMANENT;
}

function updateBlockConfigurationVisibility(refs) {
  refs.durationPanel.style.display =
    getSelectedBlockType() === WEBSITE_BLOCK_TYPE.TEMPORARY ? 'flex' : 'none';
  refs.schedulePanel.style.display =
    getSelectedBlockType() === WEBSITE_BLOCK_TYPE.SCHEDULED ? 'block' : 'none';
}

function renderScheduleOptions(refs, state) {
  refs.scheduleSelect.innerHTML = '';

  if (state.schedules.length === 0) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'Create a schedule in Manage';
    refs.scheduleSelect.appendChild(option);
    refs.scheduleSelect.disabled = true;
    return;
  }

  refs.scheduleSelect.disabled = false;
  state.schedules.forEach(schedule => {
    const option = document.createElement('option');
    option.value = schedule.id;
    option.textContent = schedule.name;
    refs.scheduleSelect.appendChild(option);
  });
}

function getSelectedScheduleDefinition(refs, state) {
  return state.schedules.find(schedule => schedule.id === refs.scheduleSelect.value) || null;
}

function updateInputForSelectedScope(refs, state) {
  const currentValue = refs.websiteInput.value.trim();
  if (currentValue === '' || currentValue === state.lastPrefill) {
    const nextValue = getSelectedBlockScope() === WEBSITE_BLOCK_SCOPE.URL
      ? state.activeUrl
      : state.activeHostname;

    if (nextValue) {
      refs.websiteInput.value = nextValue;
      state.lastPrefill = nextValue;
    }
  }

  updateInputPlaceholder(refs);
}

function updateInputPlaceholder(refs) {
  refs.websiteInput.placeholder = getSelectedBlockScope() === WEBSITE_BLOCK_SCOPE.URL
    ? 'https://example.com/page'
    : 'example.com';
}

function showInfoMessage(message, disableBlockButton) {
  const blockButton = document.getElementById('blockButton');
  const blockedWebsitesInfo = document.getElementById('pWebsiteIsBlocked');

  blockedWebsitesInfo.innerText = message;
  blockedWebsitesInfo.style.display = 'block';
  blockButton.disabled = disableBlockButton;
}

function showInfoWebsiteBlocked(refresh = false) {
  showInfoMessage('This target is already blocked.', true);
  if (refresh) {
    refreshActiveTab();
  }
}

function hideInfoWebsiteBlocked(refresh = false) {
  const blockButton = document.getElementById('blockButton');
  const blockedWebsitesInfo = document.getElementById('pWebsiteIsBlocked');

  blockedWebsitesInfo.style.display = 'none';
  blockButton.disabled = false;
  if (refresh) {
    refreshActiveTab();
  }
}

function toggleWebsitesList(show, refs) {
  const shouldShow = show === undefined
    ? getComputedStyle(refs.blockedPanel).display === 'none'
    : show;

  refs.blockedPanel.style.display = shouldShow ? 'block' : 'none';
  refs.showBlockedButton.innerText = shouldShow ? 'Hide List' : 'Show List';
  return shouldShow;
}

function toggleConfigurationBlock(show) {
  const configurationBlock = document.getElementById('blockConfiguration');
  const shouldShow = show === undefined
    ? getComputedStyle(configurationBlock).display === 'none'
    : show;

  configurationBlock.style.display = shouldShow ? 'block' : 'none';
  return shouldShow;
}

function refreshActiveTab() {
  chrome.runtime.sendMessage({ type: WebsiteBlocker.RULE_RECONCILE_MESSAGE }, function (response) {
    if (chrome.runtime.lastError || !response || !response.ok) {
      const errorMessage = chrome.runtime.lastError
        ? chrome.runtime.lastError.message
        : response && response.error;
      console.error(errorMessage || 'Blocking rules could not be updated.');
      showInfoMessage('Blocking rules could not be updated. Reload the extension and try again.', false);
      return;
    }

    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (tabs[0] && WebsiteBlocker.parseHttpInput(tabs[0].url)) {
        chrome.tabs.update(tabs[0].id, { url: tabs[0].url });
      }
    });
  });
}
