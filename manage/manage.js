document.addEventListener('DOMContentLoaded', function () {
  const refs = {
    editEntryId: document.getElementById('editEntryId'),
    entryTarget: document.getElementById('entryTarget'),
    entryDurationRow: document.getElementById('entryDurationRow'),
    entryDuration: document.getElementById('entryDuration'),
    entryDurationUnit: document.getElementById('entryDurationUnit'),
    entrySchedulePanel: document.getElementById('entrySchedulePanel'),
    entryScheduleSelect: document.getElementById('entryScheduleSelect'),
    formMessage: document.getElementById('formMessage'),
    saveEntryButton: document.getElementById('saveEntryButton'),
    resetFormButton: document.getElementById('resetFormButton'),
    clearExpiredButton: document.getElementById('clearExpiredButton'),
    searchEntries: document.getElementById('searchEntries'),
    blockedList: document.getElementById('blockedList'),
    summaryText: document.getElementById('summaryText'),
    typeRadios: document.querySelectorAll('input[name="entryType"]'),
    scopeRadios: document.querySelectorAll('input[name="entryScope"]'),
    scheduleEditId: document.getElementById('scheduleEditId'),
    scheduleName: document.getElementById('scheduleName'),
    scheduleDayCheckboxes: document.querySelectorAll('input[name="scheduleDay"]'),
    scheduleStart: document.getElementById('scheduleStart'),
    scheduleEnd: document.getElementById('scheduleEnd'),
    addScheduleIntervalButton: document.getElementById('addScheduleIntervalButton'),
    scheduleIntervalsList: document.getElementById('scheduleIntervalsList'),
    scheduleMessage: document.getElementById('scheduleMessage'),
    saveScheduleButton: document.getElementById('saveScheduleButton'),
    resetScheduleButton: document.getElementById('resetScheduleButton'),
    scheduleList: document.getElementById('scheduleList')
  };

  const state = {
    blockedWebsites: [],
    schedules: [],
    scheduleIntervals: []
  };

  refs.saveEntryButton.addEventListener('click', function () {
    saveEntryFromForm(refs, state);
  });

  refs.resetFormButton.addEventListener('click', function () {
    resetForm(refs, state);
  });

  refs.clearExpiredButton.addEventListener('click', function () {
    clearExpiredEntries(refs, state);
  });

  refs.addScheduleIntervalButton.addEventListener('click', function () {
    addScheduleInterval(refs, state);
  });

  refs.saveScheduleButton.addEventListener('click', function () {
    saveScheduleFromForm(refs, state);
  });

  refs.resetScheduleButton.addEventListener('click', function () {
    resetScheduleForm(refs, state);
  });

  refs.searchEntries.addEventListener('input', function () {
    renderBlockedWebsites(refs, state);
  });

  refs.typeRadios.forEach(radio => radio.addEventListener('change', function () {
    updateTypePanels(refs);
  }));

  refs.scopeRadios.forEach(radio => radio.addEventListener('change', function () {
    updateTargetPlaceholder(refs);
  }));

  updateTypePanels(refs);
  updateTargetPlaceholder(refs);
  renderScheduleIntervals(refs, state);
  registerStorageChangeListener(refs, state);
  loadStoredData(refs, state);
});

function registerStorageChangeListener(refs, state) {
  chrome.storage.onChanged.addListener(function (changes, namespace) {
    if (namespace !== 'local') return;

    const blockedWebsitesChange = changes[WebsiteBlocker.STORAGE_KEY];
    const schedulesChange = changes[WebsiteBlocker.SCHEDULES_STORAGE_KEY];
    if (!blockedWebsitesChange && !schedulesChange) return;

    if (blockedWebsitesChange) {
      const expirationResult = WebsiteBlocker.expireEntries(blockedWebsitesChange.newValue || []);
      state.blockedWebsites = expirationResult.entries;
      if (expirationResult.changed) {
        saveBlockedWebsites(expirationResult.entries, function () {});
      }
    }

    if (schedulesChange) {
      const selectedScheduleId = refs.entryScheduleSelect.value;
      state.schedules = WebsiteBlocker.normalizeStoredSchedules(schedulesChange.newValue || []);
      renderEntryScheduleOptions(refs, state, selectedScheduleId);
      renderScheduleList(refs, state);
    }

    renderBlockedWebsites(refs, state);
  });
}

function loadStoredData(refs, state) {
  readStoredData(function (blockedWebsites, schedules) {
    state.blockedWebsites = blockedWebsites;
    state.schedules = schedules;
    renderEntryScheduleOptions(refs, state);
    renderScheduleList(refs, state);
    renderBlockedWebsites(refs, state);
  });
}

function readStoredData(callback) {
  const defaults = {};
  defaults[WebsiteBlocker.STORAGE_KEY] = [];
  defaults[WebsiteBlocker.SCHEDULES_STORAGE_KEY] = [];

  chrome.storage.local.get(defaults, function (data) {
    const schedules = WebsiteBlocker.normalizeStoredSchedules(data[WebsiteBlocker.SCHEDULES_STORAGE_KEY]);
    const expirationResult = WebsiteBlocker.expireEntries(data[WebsiteBlocker.STORAGE_KEY]);
    if (expirationResult.changed) {
      saveBlockedWebsites(expirationResult.entries, function () {
        callback(expirationResult.entries, schedules);
      });
      return;
    }

    callback(expirationResult.entries, schedules);
  });
}

function saveBlockedWebsites(blockedWebsites, callback) {
  const value = {};
  value[WebsiteBlocker.STORAGE_KEY] = WebsiteBlocker.normalizeBlockedWebsites(blockedWebsites);
  chrome.storage.local.set(value, callback);
}

function saveScheduleDefinitions(schedules, callback) {
  const value = {};
  value[WebsiteBlocker.SCHEDULES_STORAGE_KEY] = WebsiteBlocker.normalizeStoredSchedules(schedules);
  chrome.storage.local.set(value, callback);
}

function saveEntryFromForm(refs, state) {
  const type = getSelectedType();
  const durationMs = type === WEBSITE_BLOCK_TYPE.TEMPORARY
    ? WebsiteBlocker.getDurationMs(refs.entryDuration.value, refs.entryDurationUnit.value)
    : 0;
  const selectedSchedule = type === WEBSITE_BLOCK_TYPE.SCHEDULED
    ? getSelectedScheduleDefinition(refs, state)
    : null;
  const existingEntry = state.blockedWebsites.find(site => site.id === refs.editEntryId.value);

  if (type === WEBSITE_BLOCK_TYPE.SCHEDULED && !selectedSchedule) {
    showFormMessage(refs, 'Choose a schedule for scheduled blocks.', true);
    return;
  }

  const entry = WebsiteBlocker.createEntry(refs.entryTarget.value, {
    id: existingEntry ? existingEntry.id : undefined,
    createdAt: existingEntry ? existingEntry.createdAt : undefined,
    scope: getSelectedScope(),
    type,
    status: WEBSITE_BLOCK_STATUS.ACTIVE,
    durationMs,
    scheduleId: selectedSchedule ? selectedSchedule.id : '',
    scheduleName: selectedSchedule ? selectedSchedule.name : ''
  });

  if (!entry) {
    showFormMessage(refs, 'Enter a valid website, duration, or schedule.', true);
    return;
  }

  const editableEntries = refs.editEntryId.value
    ? state.blockedWebsites.filter(site => site.id !== refs.editEntryId.value)
    : state.blockedWebsites;
  const nextBlockedWebsites = WebsiteBlocker.upsertEntry(editableEntries, entry);

  saveBlockedWebsites(nextBlockedWebsites, function () {
    state.blockedWebsites = nextBlockedWebsites;
    resetForm(refs, state);
    renderBlockedWebsites(refs, state);
    showFormMessage(refs, 'Entry saved.', false);
  });
}

function renderBlockedWebsites(refs, state) {
  const query = refs.searchEntries.value.trim().toLowerCase();
  const hydratedWebsites = WebsiteBlocker.hydrateEntriesWithSchedules(state.blockedWebsites, state.schedules);
  const blockedWebsites = hydratedWebsites.filter(site => {
    if (query === '') return true;
    return [
      WebsiteBlocker.getDisplayTarget(site),
      WebsiteBlocker.getScopeText(site),
      WebsiteBlocker.getTypeText(site),
      WebsiteBlocker.getStatusText(site),
      WebsiteBlocker.formatExpiresAt(site),
      site.scheduleName || '',
      WebsiteBlocker.formatSchedule(site.schedule)
    ].some(value => value.toLowerCase().includes(query));
  });

  refs.blockedList.innerHTML = '';
  updateSummary(refs, hydratedWebsites);

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
      editEntry(refs, state, site);
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

  if (site.type === WEBSITE_BLOCK_TYPE.SCHEDULED) {
    parts.push(site.scheduleName || 'Missing schedule');
    const scheduleText = WebsiteBlocker.formatSchedule(site.schedule);
    if (scheduleText) {
      parts.push(scheduleText);
    }
  }

  return parts.join(' | ');
}

function getToggleButtonText(site) {
  if (WebsiteBlocker.isExpiredEntry(site)) return 'Make Permanent';
  return site.status === WEBSITE_BLOCK_STATUS.ACTIVE ? 'Pause' : 'Resume';
}

function editEntry(refs, state, site) {
  refs.editEntryId.value = site.id;
  refs.entryTarget.value = WebsiteBlocker.getDisplayTarget(site);
  setRadioValue('entryScope', site.scope);
  setRadioValue('entryType', String(site.type));
  renderEntryScheduleOptions(refs, state, site.scheduleId);

  if (site.type === WEBSITE_BLOCK_TYPE.TEMPORARY && site.expiresAt && !WebsiteBlocker.isExpiredEntry(site)) {
    const duration = WebsiteBlocker.getDurationParts(Number(site.expiresAt) - Date.now());
    refs.entryDuration.value = duration.value;
    refs.entryDurationUnit.value = duration.unit;
  } else {
    refs.entryDuration.value = WebsiteBlocker.DEFAULT_DURATION_MINUTES;
    refs.entryDurationUnit.value = 'minutes';
  }

  updateTypePanels(refs);
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
        scheduleId: '',
        scheduleName: '',
        schedule: null,
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

function resetForm(refs, state) {
  refs.editEntryId.value = '';
  refs.entryTarget.value = '';
  refs.entryDuration.value = WebsiteBlocker.DEFAULT_DURATION_MINUTES;
  refs.entryDurationUnit.value = 'minutes';
  setRadioValue('entryScope', WEBSITE_BLOCK_SCOPE.DOMAIN);
  setRadioValue('entryType', String(WEBSITE_BLOCK_TYPE.PERMANENT));
  renderEntryScheduleOptions(refs, state, '');
  updateTypePanels(refs);
  updateTargetPlaceholder(refs);
  showFormMessage(refs, '', false);
}

function showFormMessage(refs, message, isError) {
  refs.formMessage.textContent = message;
  refs.formMessage.className = isError ? 'error' : '';
}

function showScheduleMessage(refs, message, isError) {
  refs.scheduleMessage.textContent = message;
  refs.scheduleMessage.className = isError ? 'error' : '';
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

function updateTypePanels(refs) {
  refs.entryDurationRow.style.display =
    getSelectedType() === WEBSITE_BLOCK_TYPE.TEMPORARY ? 'flex' : 'none';
  refs.entrySchedulePanel.style.display =
    getSelectedType() === WEBSITE_BLOCK_TYPE.SCHEDULED ? 'block' : 'none';
}

function updateTargetPlaceholder(refs) {
  refs.entryTarget.placeholder = getSelectedScope() === WEBSITE_BLOCK_SCOPE.URL
    ? 'https://example.com/page'
    : 'example.com';
}

function renderEntryScheduleOptions(refs, state, selectedScheduleId = refs.entryScheduleSelect.value) {
  refs.entryScheduleSelect.innerHTML = '';

  if (state.schedules.length === 0) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'Create a schedule below first';
    refs.entryScheduleSelect.appendChild(option);
    refs.entryScheduleSelect.disabled = true;
    return;
  }

  refs.entryScheduleSelect.disabled = false;

  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Select schedule';
  refs.entryScheduleSelect.appendChild(placeholder);

  state.schedules.forEach(schedule => {
    const option = document.createElement('option');
    option.value = schedule.id;
    option.textContent = schedule.name;
    refs.entryScheduleSelect.appendChild(option);
  });

  refs.entryScheduleSelect.value = state.schedules.some(schedule => schedule.id === selectedScheduleId)
    ? selectedScheduleId
    : '';
}

function getSelectedScheduleDefinition(refs, state) {
  return state.schedules.find(schedule => schedule.id === refs.entryScheduleSelect.value) || null;
}

function saveScheduleFromForm(refs, state) {
  const existingSchedule = state.schedules.find(schedule => schedule.id === refs.scheduleEditId.value);
  const scheduleDefinition = WebsiteBlocker.createScheduleDefinition(
    refs.scheduleName.value,
    { intervals: state.scheduleIntervals },
    {
      id: existingSchedule ? existingSchedule.id : undefined,
      createdAt: existingSchedule ? existingSchedule.createdAt : undefined
    }
  );

  if (!scheduleDefinition) {
    showScheduleMessage(refs, 'Enter a schedule name and at least one interval.', true);
    return;
  }

  const duplicateName = state.schedules.some(schedule =>
    schedule.id !== scheduleDefinition.id &&
    schedule.name.toLowerCase() === scheduleDefinition.name.toLowerCase()
  );
  if (duplicateName) {
    showScheduleMessage(refs, 'Schedule name already exists.', true);
    return;
  }

  const nextSchedules = WebsiteBlocker.upsertScheduleDefinition(state.schedules, scheduleDefinition);
  saveScheduleDefinitions(nextSchedules, function () {
    state.schedules = nextSchedules;
    resetScheduleForm(refs, state);
    renderEntryScheduleOptions(refs, state, scheduleDefinition.id);
    renderScheduleList(refs, state);
    renderBlockedWebsites(refs, state);
    showScheduleMessage(refs, 'Schedule saved.', false);
  });
}

function addScheduleInterval(refs, state) {
  const selectedDays = Array.from(refs.scheduleDayCheckboxes)
    .filter(checkbox => checkbox.checked)
    .map(checkbox => Number(checkbox.value));
  const schedule = WebsiteBlocker.createScheduleFromDays(
    selectedDays,
    refs.scheduleStart.value,
    refs.scheduleEnd.value
  );

  if (!schedule) {
    showScheduleMessage(refs, 'Select days and valid start/end times.', true);
    return;
  }

  state.scheduleIntervals = WebsiteBlocker.normalizeSchedule({
    intervals: [...state.scheduleIntervals, ...schedule.intervals]
  }).intervals;
  renderScheduleIntervals(refs, state);
  showScheduleMessage(refs, 'Schedule interval added.', false);
}

function renderScheduleIntervals(refs, state) {
  refs.scheduleIntervalsList.innerHTML = '';

  if (state.scheduleIntervals.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty-list';
    li.textContent = 'No schedule intervals.';
    refs.scheduleIntervalsList.appendChild(li);
    return;
  }

  state.scheduleIntervals.forEach((interval, index) => {
    const li = document.createElement('li');
    li.className = 'schedule-interval';

    const text = document.createElement('span');
    text.textContent = `${WebsiteBlocker.WEEKDAY_LABELS[interval.day]} ${interval.start}-${interval.end}`;

    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.textContent = 'Remove';
    removeButton.addEventListener('click', function () {
      state.scheduleIntervals.splice(index, 1);
      renderScheduleIntervals(refs, state);
    });

    li.appendChild(text);
    li.appendChild(removeButton);
    refs.scheduleIntervalsList.appendChild(li);
  });
}

function renderScheduleList(refs, state) {
  refs.scheduleList.innerHTML = '';

  if (state.schedules.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty-list';
    li.textContent = 'No schedules created.';
    refs.scheduleList.appendChild(li);
    return;
  }

  state.schedules.forEach(schedule => {
    const li = document.createElement('li');
    li.className = 'schedule-row';

    const details = document.createElement('div');
    details.className = 'schedule-details';

    const name = document.createElement('span');
    name.className = 'schedule-name';
    name.textContent = schedule.name;

    const meta = document.createElement('span');
    meta.className = 'schedule-meta';
    meta.textContent = WebsiteBlocker.formatSchedule(schedule);

    details.appendChild(name);
    details.appendChild(meta);

    const actions = document.createElement('div');
    actions.className = 'schedule-actions';

    const editButton = document.createElement('button');
    editButton.type = 'button';
    editButton.textContent = 'Edit';
    editButton.addEventListener('click', function () {
      editSchedule(refs, state, schedule);
    });

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.textContent = 'Delete';
    deleteButton.addEventListener('click', function () {
      deleteSchedule(refs, state, schedule);
    });

    actions.appendChild(editButton);
    actions.appendChild(deleteButton);
    li.appendChild(details);
    li.appendChild(actions);
    refs.scheduleList.appendChild(li);
  });
}

function editSchedule(refs, state, schedule) {
  refs.scheduleEditId.value = schedule.id;
  refs.scheduleName.value = schedule.name;
  state.scheduleIntervals = [...schedule.intervals];
  renderScheduleIntervals(refs, state);
  showScheduleMessage(refs, 'Editing schedule.', false);
}

function deleteSchedule(refs, state, schedule) {
  const isUsed = state.blockedWebsites.some(site =>
    site.type === WEBSITE_BLOCK_TYPE.SCHEDULED &&
    (
      site.scheduleId === schedule.id ||
      String(site.scheduleName || '').toLowerCase() === schedule.name.toLowerCase()
    )
  );
  if (isUsed) {
    showScheduleMessage(refs, 'Schedule is used by blocked entries.', true);
    return;
  }

  const nextSchedules = WebsiteBlocker.removeScheduleDefinition(state.schedules, schedule.id);
  saveScheduleDefinitions(nextSchedules, function () {
    state.schedules = nextSchedules;
    if (refs.scheduleEditId.value === schedule.id) {
      resetScheduleForm(refs, state);
    }
    renderEntryScheduleOptions(refs, state);
    renderScheduleList(refs, state);
    showScheduleMessage(refs, 'Schedule deleted.', false);
  });
}

function resetScheduleForm(refs, state) {
  refs.scheduleEditId.value = '';
  refs.scheduleName.value = '';
  refs.scheduleStart.value = '09:00';
  refs.scheduleEnd.value = '18:00';
  refs.scheduleDayCheckboxes.forEach(checkbox => {
    const day = Number(checkbox.value);
    checkbox.checked = day >= 1 && day <= 5;
  });
  state.scheduleIntervals = [];
  renderScheduleIntervals(refs, state);
  showScheduleMessage(refs, '', false);
}
