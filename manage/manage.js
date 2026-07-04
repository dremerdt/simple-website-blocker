document.addEventListener('DOMContentLoaded', function () {
  const refs = {
    editEntryId: document.getElementById('editEntryId'),
    entryTarget: document.getElementById('entryTarget'),
    entryDurationRow: document.getElementById('entryDurationRow'),
    entryDuration: document.getElementById('entryDuration'),
    entryDurationUnit: document.getElementById('entryDurationUnit'),
    formMessage: document.getElementById('formMessage'),
    saveEntryButton: document.getElementById('saveEntryButton'),
    resetFormButton: document.getElementById('resetFormButton'),
    clearExpiredButton: document.getElementById('clearExpiredButton'),
    searchEntries: document.getElementById('searchEntries'),
    blockedList: document.getElementById('blockedList'),
    summaryText: document.getElementById('summaryText'),
    typeRadios: document.querySelectorAll('input[name="entryType"]'),
    scopeRadios: document.querySelectorAll('input[name="entryScope"]')
  };

  const state = {
    blockedWebsites: []
  };

  refs.saveEntryButton.addEventListener('click', function () {
    saveEntryFromForm(refs, state);
  });

  refs.resetFormButton.addEventListener('click', function () {
    resetForm(refs);
  });

  refs.clearExpiredButton.addEventListener('click', function () {
    clearExpiredEntries(refs, state);
  });

  refs.searchEntries.addEventListener('input', function () {
    renderBlockedWebsites(refs, state);
  });

  refs.typeRadios.forEach(radio => radio.addEventListener('change', function () {
    updateDurationVisibility(refs);
  }));

  refs.scopeRadios.forEach(radio => radio.addEventListener('change', function () {
    updateTargetPlaceholder(refs);
  }));

  updateDurationVisibility(refs);
  updateTargetPlaceholder(refs);
  loadBlockedWebsites(refs, state);
});

function loadBlockedWebsites(refs, state) {
  readBlockedWebsites(function (blockedWebsites) {
    state.blockedWebsites = blockedWebsites;
    renderBlockedWebsites(refs, state);
  });
}

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

function saveEntryFromForm(refs, state) {
  const type = getSelectedType();
  const durationMs = type === WEBSITE_BLOCK_TYPE.TEMPORARY
    ? WebsiteBlocker.getDurationMs(refs.entryDuration.value, refs.entryDurationUnit.value)
    : 0;
  const existingEntry = state.blockedWebsites.find(site => site.id === refs.editEntryId.value);

  const entry = WebsiteBlocker.createEntry(refs.entryTarget.value, {
    id: existingEntry ? existingEntry.id : undefined,
    createdAt: existingEntry ? existingEntry.createdAt : undefined,
    scope: getSelectedScope(),
    type,
    status: WEBSITE_BLOCK_STATUS.ACTIVE,
    durationMs
  });

  if (!entry) {
    showFormMessage(refs, 'Enter a valid website or duration.', true);
    return;
  }

  const editableEntries = refs.editEntryId.value
    ? state.blockedWebsites.filter(site => site.id !== refs.editEntryId.value)
    : state.blockedWebsites;
  const nextBlockedWebsites = WebsiteBlocker.upsertEntry(editableEntries, entry);

  saveBlockedWebsites(nextBlockedWebsites, function () {
    state.blockedWebsites = nextBlockedWebsites;
    resetForm(refs);
    renderBlockedWebsites(refs, state);
    showFormMessage(refs, 'Entry saved.', false);
  });
}

function renderBlockedWebsites(refs, state) {
  const query = refs.searchEntries.value.trim().toLowerCase();
  const blockedWebsites = state.blockedWebsites.filter(site => {
    if (query === '') return true;
    return [
      WebsiteBlocker.getDisplayTarget(site),
      WebsiteBlocker.getScopeText(site),
      WebsiteBlocker.getTypeText(site),
      WebsiteBlocker.getStatusText(site)
    ].some(value => value.toLowerCase().includes(query));
  });

  refs.blockedList.innerHTML = '';
  updateSummary(refs, state.blockedWebsites);

  if (blockedWebsites.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty-list';
    li.textContent = query ? 'No matching entries.' : 'No blocked websites.';
    refs.blockedList.appendChild(li);
    return;
  }

  for (const site of blockedWebsites) {
    const li = document.createElement('li');
    li.className = 'blocked-row';
    if (!WebsiteBlocker.isEntryBlocking(site)) {
      li.classList.add('inactive');
    }

    const details = document.createElement('div');
    details.className = 'entry-details';

    const target = document.createElement('span');
    target.className = 'entry-target';
    target.textContent = WebsiteBlocker.getDisplayTarget(site);

    const meta = document.createElement('span');
    meta.className = 'entry-meta';
    meta.textContent = getEntryMeta(site);

    details.appendChild(target);
    details.appendChild(meta);

    const actions = document.createElement('div');
    actions.className = 'entry-actions';

    const editButton = document.createElement('button');
    editButton.type = 'button';
    editButton.textContent = 'Edit';
    editButton.addEventListener('click', function () {
      editEntry(refs, site);
    });

    const toggleButton = document.createElement('button');
    toggleButton.type = 'button';
    toggleButton.textContent = getToggleButtonText(site);
    toggleButton.addEventListener('click', function () {
      toggleWebsiteStatus(refs, state, site.id);
    });

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.textContent = 'Delete';
    deleteButton.addEventListener('click', function () {
      deleteWebsite(refs, state, site.id);
    });

    actions.appendChild(editButton);
    actions.appendChild(toggleButton);
    actions.appendChild(deleteButton);
    li.appendChild(details);
    li.appendChild(actions);
    refs.blockedList.appendChild(li);
  }
}

function updateSummary(refs, blockedWebsites) {
  const activeCount = blockedWebsites.filter(site => WebsiteBlocker.isEntryBlocking(site)).length;
  const expiredCount = blockedWebsites.filter(site => WebsiteBlocker.isExpiredEntry(site)).length;
  const total = blockedWebsites.length;
  refs.summaryText.textContent = `${activeCount} active | ${expiredCount} expired | ${total} total`;
}

function getEntryMeta(site) {
  const parts = [
    WebsiteBlocker.getScopeText(site),
    WebsiteBlocker.getTypeText(site),
    WebsiteBlocker.getStatusText(site)
  ];
  const expiresText = WebsiteBlocker.formatExpiresAt(site);
  if (expiresText) {
    parts.push(expiresText);
  }

  return parts.join(' | ');
}

function getToggleButtonText(site) {
  if (WebsiteBlocker.isExpiredEntry(site)) return 'Reactivate';
  return site.status === WEBSITE_BLOCK_STATUS.ACTIVE ? 'Pause' : 'Resume';
}

function editEntry(refs, site) {
  refs.editEntryId.value = site.id;
  refs.entryTarget.value = WebsiteBlocker.getDisplayTarget(site);
  setRadioValue('entryScope', site.scope);
  setRadioValue('entryType', String(site.type));

  if (site.type === WEBSITE_BLOCK_TYPE.TEMPORARY && site.expiresAt && !WebsiteBlocker.isExpiredEntry(site)) {
    const duration = WebsiteBlocker.getDurationParts(Number(site.expiresAt) - Date.now());
    refs.entryDuration.value = duration.value;
    refs.entryDurationUnit.value = duration.unit;
  } else {
    refs.entryDuration.value = WebsiteBlocker.DEFAULT_DURATION_MINUTES;
    refs.entryDurationUnit.value = 'minutes';
  }

  updateDurationVisibility(refs);
  updateTargetPlaceholder(refs);
  showFormMessage(refs, 'Editing entry.', false);
}

function toggleWebsiteStatus(refs, state, id) {
  const now = Date.now();
  const nextBlockedWebsites = state.blockedWebsites.map(site => {
    if (site.id !== id) return site;

    if (WebsiteBlocker.isExpiredEntry(site, now)) {
      return {
        ...site,
        status: WEBSITE_BLOCK_STATUS.ACTIVE,
        type: WEBSITE_BLOCK_TYPE.PERMANENT,
        expiresAt: null,
        updatedAt: now
      };
    }

    return {
      ...site,
      status: site.status === WEBSITE_BLOCK_STATUS.ACTIVE
        ? WEBSITE_BLOCK_STATUS.INACTIVE
        : WEBSITE_BLOCK_STATUS.ACTIVE,
      updatedAt: now
    };
  });

  saveBlockedWebsites(nextBlockedWebsites, function () {
    state.blockedWebsites = nextBlockedWebsites;
    renderBlockedWebsites(refs, state);
  });
}

function deleteWebsite(refs, state, id) {
  const nextBlockedWebsites = state.blockedWebsites.filter(site => site.id !== id);
  saveBlockedWebsites(nextBlockedWebsites, function () {
    state.blockedWebsites = nextBlockedWebsites;
    renderBlockedWebsites(refs, state);
  });
}

function clearExpiredEntries(refs, state) {
  const nextBlockedWebsites = state.blockedWebsites.filter(site => !WebsiteBlocker.isExpiredEntry(site));
  saveBlockedWebsites(nextBlockedWebsites, function () {
    state.blockedWebsites = nextBlockedWebsites;
    renderBlockedWebsites(refs, state);
    showFormMessage(refs, 'Expired entries cleared.', false);
  });
}

function resetForm(refs) {
  refs.editEntryId.value = '';
  refs.entryTarget.value = '';
  refs.entryDuration.value = WebsiteBlocker.DEFAULT_DURATION_MINUTES;
  refs.entryDurationUnit.value = 'minutes';
  setRadioValue('entryScope', WEBSITE_BLOCK_SCOPE.DOMAIN);
  setRadioValue('entryType', String(WEBSITE_BLOCK_TYPE.PERMANENT));
  updateDurationVisibility(refs);
  updateTargetPlaceholder(refs);
  showFormMessage(refs, '', false);
}

function showFormMessage(refs, message, isError) {
  refs.formMessage.textContent = message;
  refs.formMessage.className = isError ? 'error' : '';
}

function getSelectedScope() {
  const selected = document.querySelector('input[name="entryScope"]:checked');
  return selected ? selected.value : WEBSITE_BLOCK_SCOPE.DOMAIN;
}

function getSelectedType() {
  const selected = document.querySelector('input[name="entryType"]:checked');
  return selected ? Number(selected.value) : WEBSITE_BLOCK_TYPE.PERMANENT;
}

function setRadioValue(name, value) {
  const radio = document.querySelector(`input[name="${name}"][value="${value}"]`);
  if (radio) {
    radio.checked = true;
  }
}

function updateDurationVisibility(refs) {
  refs.entryDurationRow.style.display =
    getSelectedType() === WEBSITE_BLOCK_TYPE.TEMPORARY ? 'flex' : 'none';
}

function updateTargetPlaceholder(refs) {
  refs.entryTarget.placeholder = getSelectedScope() === WEBSITE_BLOCK_SCOPE.URL
    ? 'https://example.com/page'
    : 'example.com';
}
