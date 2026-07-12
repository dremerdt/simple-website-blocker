var WebsiteBlocker = (function () {
  const STORAGE_KEY = 'blockedWebsites';
  const SCHEDULES_STORAGE_KEY = 'blockSchedules';
  const RULE_REFRESH_ALARM_NAME = 'website-blocker-rule-refresh';
  const RULE_RECONCILE_MESSAGE = 'website-blocker-reconcile-rules';
  const DEFAULT_DURATION_MINUTES = 30;
  const MINUTE_MS = 60 * 1000;
  const HOUR_MS = 60 * MINUTE_MS;
  const DAY_MS = 24 * HOUR_MS;
  const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  function parseHttpInput(input) {
    if (typeof input !== 'string') return null;

    let value = input.trim();
    if (value === '') return null;
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
      value = `https://${value}`;
    }

    try {
      const parsedUrl = new URL(value);
      if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        return null;
      }

      parsedUrl.hash = '';
      return {
        hostname: parsedUrl.hostname.toLowerCase().replace(/\.$/, ''),
        url: parsedUrl.href
      };
    } catch {
      return null;
    }
  }

  function normalizeBlockInput(input, scope) {
    const parsed = parseHttpInput(input);
    if (!parsed || parsed.hostname === '') return null;

    const normalizedScope = normalizeScope(scope);
    if (normalizedScope === WEBSITE_BLOCK_SCOPE.URL) {
      return {
        scope: WEBSITE_BLOCK_SCOPE.URL,
        hostname: parsed.hostname,
        url: parsed.url,
        target: parsed.url
      };
    }

    return {
      scope: WEBSITE_BLOCK_SCOPE.DOMAIN,
      hostname: parsed.hostname,
      url: null,
      target: parsed.hostname
    };
  }

  function normalizeScope(scope) {
    return scope === WEBSITE_BLOCK_SCOPE.URL
      ? WEBSITE_BLOCK_SCOPE.URL
      : WEBSITE_BLOCK_SCOPE.DOMAIN;
  }

  function normalizeType(type) {
    const numericType = Number(type);
    if (numericType === WEBSITE_BLOCK_TYPE.TEMPORARY) return WEBSITE_BLOCK_TYPE.TEMPORARY;
    if (numericType === WEBSITE_BLOCK_TYPE.SCHEDULED) return WEBSITE_BLOCK_TYPE.SCHEDULED;
    return WEBSITE_BLOCK_TYPE.PERMANENT;
  }

  function normalizeStatus(status) {
    return Number(status) === WEBSITE_BLOCK_STATUS.INACTIVE
      ? WEBSITE_BLOCK_STATUS.INACTIVE
      : WEBSITE_BLOCK_STATUS.ACTIVE;
  }

  function getDurationMs(value, unit) {
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount <= 0) return 0;

    switch (unit) {
      case 'days':
        return amount * DAY_MS;
      case 'hours':
        return amount * HOUR_MS;
      case 'minutes':
      default:
        return amount * MINUTE_MS;
    }
  }

  function getDurationParts(durationMs) {
    if (!Number.isFinite(durationMs) || durationMs <= 0) {
      return { value: DEFAULT_DURATION_MINUTES, unit: 'minutes' };
    }

    if (durationMs % DAY_MS === 0) {
      return { value: durationMs / DAY_MS, unit: 'days' };
    }

    if (durationMs % HOUR_MS === 0) {
      return { value: durationMs / HOUR_MS, unit: 'hours' };
    }

    return { value: Math.max(1, Math.ceil(durationMs / MINUTE_MS)), unit: 'minutes' };
  }

  function createId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }

    return `block-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  function normalizeScheduleId(value) {
    if (typeof value !== 'string') return '';
    return value.trim();
  }

  function normalizeScheduleName(value) {
    if (typeof value !== 'string') return '';
    return value.trim().replace(/\s+/g, ' ');
  }

  function createEntry(input, options = {}) {
    const scope = normalizeScope(options.scope);
    const blockInput = normalizeBlockInput(input, scope);
    if (!blockInput) return null;

    const now = Number(options.now) || Date.now();
    const requestedType = normalizeType(options.type);
    const durationMs = requestedType === WEBSITE_BLOCK_TYPE.TEMPORARY
      ? Number(options.durationMs)
      : 0;
    const schedule = requestedType === WEBSITE_BLOCK_TYPE.SCHEDULED
      ? normalizeSchedule(options.schedule)
      : null;
    const scheduleId = requestedType === WEBSITE_BLOCK_TYPE.SCHEDULED
      ? normalizeScheduleId(options.scheduleId || (options.schedule && options.schedule.id))
      : '';
    const scheduleName = requestedType === WEBSITE_BLOCK_TYPE.SCHEDULED
      ? normalizeScheduleName(options.scheduleName || (options.schedule && options.schedule.name))
      : '';

    if (requestedType === WEBSITE_BLOCK_TYPE.TEMPORARY && (!Number.isFinite(durationMs) || durationMs <= 0)) {
      return null;
    }

    if (requestedType === WEBSITE_BLOCK_TYPE.SCHEDULED && !schedule && !scheduleId) {
      return null;
    }

    return {
      id: options.id || createId(),
      scope: blockInput.scope,
      hostname: blockInput.hostname,
      url: blockInput.url,
      target: blockInput.target,
      status: normalizeStatus(options.status),
      type: requestedType,
      createdAt: Number(options.createdAt) || now,
      updatedAt: now,
      expiresAt: requestedType === WEBSITE_BLOCK_TYPE.TEMPORARY ? now + durationMs : null,
      scheduleId: requestedType === WEBSITE_BLOCK_TYPE.SCHEDULED ? scheduleId : '',
      scheduleName: requestedType === WEBSITE_BLOCK_TYPE.SCHEDULED ? scheduleName : '',
      schedule: requestedType === WEBSITE_BLOCK_TYPE.SCHEDULED ? schedule : null
    };
  }

  function normalizeEntry(site, now = Date.now()) {
    if (typeof site === 'string') {
      return createEntry(site, {
        now,
        type: WEBSITE_BLOCK_TYPE.PERMANENT,
        status: WEBSITE_BLOCK_STATUS.ACTIVE
      });
    }

    if (!site || typeof site !== 'object') return null;

    const scope = normalizeScope(site.scope || (site.url ? WEBSITE_BLOCK_SCOPE.URL : WEBSITE_BLOCK_SCOPE.DOMAIN));
    const input = scope === WEBSITE_BLOCK_SCOPE.URL
      ? (site.url || site.target || site.hostname || '')
      : (site.hostname || site.target || site.url || '');
    const blockInput = normalizeBlockInput(input, scope);
    if (!blockInput) return null;

    const createdAt = Number(site.createdAt) || now;
    const updatedAt = Number(site.updatedAt) || createdAt;
    const requestedType = normalizeType(site.type);
    const expiresAt = Number(site.expiresAt);
    const hasValidExpiration = Number.isFinite(expiresAt) && expiresAt > 0;
    const schedule = normalizeSchedule(site.schedule);
    const scheduleId = normalizeScheduleId(site.scheduleId || (site.schedule && site.schedule.id));
    const scheduleName = normalizeScheduleName(site.scheduleName || (site.schedule && site.schedule.name));
    let normalizedType = WEBSITE_BLOCK_TYPE.PERMANENT;

    if (requestedType === WEBSITE_BLOCK_TYPE.SCHEDULED && !schedule && !scheduleId) {
      return null;
    }

    if (requestedType === WEBSITE_BLOCK_TYPE.TEMPORARY && hasValidExpiration) {
      normalizedType = WEBSITE_BLOCK_TYPE.TEMPORARY;
    } else if (requestedType === WEBSITE_BLOCK_TYPE.SCHEDULED && (schedule || scheduleId)) {
      normalizedType = WEBSITE_BLOCK_TYPE.SCHEDULED;
    }

    return {
      id: site.id || createId(),
      scope: blockInput.scope,
      hostname: blockInput.hostname,
      url: blockInput.url,
      target: blockInput.target,
      status: normalizeStatus(site.status),
      type: normalizedType,
      createdAt,
      updatedAt,
      expiresAt: normalizedType === WEBSITE_BLOCK_TYPE.TEMPORARY ? expiresAt : null,
      scheduleId: normalizedType === WEBSITE_BLOCK_TYPE.SCHEDULED ? scheduleId : '',
      scheduleName: normalizedType === WEBSITE_BLOCK_TYPE.SCHEDULED ? scheduleName : '',
      schedule: normalizedType === WEBSITE_BLOCK_TYPE.SCHEDULED ? schedule : null
    };
  }

  function normalizeBlockedWebsites(blockedWebsites, now = Date.now()) {
    if (!Array.isArray(blockedWebsites)) return [];

    const seenTargets = new Set();
    return blockedWebsites
      .map(site => normalizeEntry(site, now))
      .filter(Boolean)
      .filter(site => {
        const key = getEntryKey(site);
        if (seenTargets.has(key)) return false;
        seenTargets.add(key);
        return true;
      });
  }

  function getEntryKey(entry) {
    return `${entry.scope}:${entry.target}`;
  }

  function upsertEntry(entries, entry, now = Date.now()) {
    const normalizedEntries = normalizeBlockedWebsites(entries, now);
    const index = normalizedEntries.findIndex(site => getEntryKey(site) === getEntryKey(entry));
    if (index === -1) {
      return [...normalizedEntries, entry];
    }

    normalizedEntries[index] = {
      ...entry,
      id: normalizedEntries[index].id,
      createdAt: normalizedEntries[index].createdAt,
      updatedAt: now
    };
    return normalizedEntries;
  }

  function removeEntry(entries, entry) {
    const key = getEntryKey(entry);
    return normalizeBlockedWebsites(entries).filter(site => getEntryKey(site) !== key);
  }

  function createScheduleDefinition(name, schedule, options = {}) {
    const normalizedName = normalizeScheduleName(name);
    const normalizedSchedule = normalizeSchedule(schedule);
    if (!normalizedName || !normalizedSchedule) return null;

    const now = Number(options.now) || Date.now();
    return {
      id: normalizeScheduleId(options.id) || createId(),
      name: normalizedName,
      timezone: 'local',
      intervals: normalizedSchedule.intervals,
      createdAt: Number(options.createdAt) || now,
      updatedAt: now
    };
  }

  function normalizeScheduleDefinition(scheduleDefinition, now = Date.now()) {
    if (!scheduleDefinition || typeof scheduleDefinition !== 'object') return null;

    const normalizedName = normalizeScheduleName(scheduleDefinition.name);
    const normalizedSchedule = normalizeSchedule(scheduleDefinition);
    if (!normalizedName || !normalizedSchedule) return null;

    const createdAt = Number(scheduleDefinition.createdAt) || now;
    return {
      id: normalizeScheduleId(scheduleDefinition.id) || createId(),
      name: normalizedName,
      timezone: 'local',
      intervals: normalizedSchedule.intervals,
      createdAt,
      updatedAt: Number(scheduleDefinition.updatedAt) || createdAt
    };
  }

  function normalizeStoredSchedules(schedules, now = Date.now()) {
    if (!Array.isArray(schedules)) return [];

    const seenIds = new Set();
    return schedules
      .map(schedule => normalizeScheduleDefinition(schedule, now))
      .filter(Boolean)
      .filter(schedule => {
        if (seenIds.has(schedule.id)) return false;
        seenIds.add(schedule.id);
        return true;
      })
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  function upsertScheduleDefinition(schedules, scheduleDefinition, now = Date.now()) {
    const normalizedSchedule = normalizeScheduleDefinition(scheduleDefinition, now);
    if (!normalizedSchedule) return normalizeStoredSchedules(schedules, now);

    return normalizeStoredSchedules([
      ...normalizeStoredSchedules(schedules, now).filter(schedule => schedule.id !== normalizedSchedule.id),
      normalizedSchedule
    ], now);
  }

  function removeScheduleDefinition(schedules, scheduleId, now = Date.now()) {
    const normalizedScheduleId = normalizeScheduleId(scheduleId);
    return normalizeStoredSchedules(schedules, now)
      .filter(schedule => schedule.id !== normalizedScheduleId);
  }

  function getScheduleById(schedules, scheduleId) {
    const normalizedScheduleId = normalizeScheduleId(scheduleId);
    if (!normalizedScheduleId) return null;

    return normalizeStoredSchedules(schedules)
      .find(schedule => schedule.id === normalizedScheduleId) || null;
  }

  function getScheduleByName(schedules, scheduleName) {
    const normalizedScheduleName = normalizeScheduleName(scheduleName).toLowerCase();
    if (!normalizedScheduleName) return null;

    return normalizeStoredSchedules(schedules)
      .find(schedule => schedule.name.toLowerCase() === normalizedScheduleName) || null;
  }

  function getEntryScheduleDefinition(entry, schedules) {
    if (!entry || entry.type !== WEBSITE_BLOCK_TYPE.SCHEDULED) return null;

    const scheduleById = getScheduleById(schedules, entry.scheduleId);
    if (scheduleById) return scheduleById;

    const scheduleByName = getScheduleByName(schedules, entry.scheduleName);
    if (scheduleByName) return scheduleByName;

    const inlineSchedule = normalizeSchedule(entry.schedule);
    if (!inlineSchedule) return null;

    return {
      id: normalizeScheduleId(entry.scheduleId),
      name: normalizeScheduleName(entry.scheduleName),
      timezone: 'local',
      intervals: inlineSchedule.intervals
    };
  }

  function hydrateEntrySchedule(entry, schedules) {
    const normalizedEntry = normalizeEntry(entry);
    if (!normalizedEntry || normalizedEntry.type !== WEBSITE_BLOCK_TYPE.SCHEDULED) {
      return normalizedEntry;
    }

    const scheduleDefinition = getEntryScheduleDefinition(normalizedEntry, schedules);
    if (!scheduleDefinition) {
      return {
        ...normalizedEntry,
        schedule: null
      };
    }

    return {
      ...normalizedEntry,
      scheduleId: normalizeScheduleId(scheduleDefinition.id) || normalizedEntry.scheduleId,
      scheduleName: normalizeScheduleName(scheduleDefinition.name) || normalizedEntry.scheduleName,
      schedule: normalizeSchedule(scheduleDefinition)
    };
  }

  function hydrateEntriesWithSchedules(entries, schedules, now = Date.now()) {
    return normalizeBlockedWebsites(entries, now)
      .map(entry => hydrateEntrySchedule(entry, schedules))
      .filter(Boolean);
  }

  function normalizeSchedule(schedule) {
    if (!schedule || !Array.isArray(schedule.intervals)) return null;

    const seenIntervals = new Set();
    const intervals = schedule.intervals
      .map(normalizeScheduleInterval)
      .filter(Boolean)
      .filter(interval => {
        const key = `${interval.day}:${interval.start}:${interval.end}`;
        if (seenIntervals.has(key)) return false;
        seenIntervals.add(key);
        return true;
      })
      .sort((left, right) => {
        if (left.day !== right.day) return left.day - right.day;
        return timeToMinutes(left.start) - timeToMinutes(right.start);
      });

    if (intervals.length === 0) return null;

    return {
      timezone: 'local',
      intervals
    };
  }

  function normalizeScheduleInterval(interval) {
    if (!interval || typeof interval !== 'object') return null;

    const day = Number(interval.day);
    if (!Number.isInteger(day) || day < 0 || day > 6) return null;

    const start = normalizeTimeString(interval.start);
    const end = normalizeTimeString(interval.end);
    if (!start || !end || start === end) return null;

    return { day, start, end };
  }

  function normalizeTimeString(value) {
    if (typeof value !== 'string') return null;

    const match = value.trim().match(/^([01]\d|2[0-3]):([0-5]\d)$/);
    if (!match) return null;

    return `${match[1]}:${match[2]}`;
  }

  function createScheduleFromDays(days, start, end) {
    if (!Array.isArray(days)) return null;

    return normalizeSchedule({
      intervals: days.map(day => ({ day, start, end }))
    });
  }

  function timeToMinutes(value) {
    const [hours, minutes] = value.split(':').map(Number);
    return (hours * 60) + minutes;
  }

  function getExpandedScheduleSegments(schedule) {
    const normalizedSchedule = normalizeSchedule(schedule);
    if (!normalizedSchedule) return [];

    const segments = [];
    for (const interval of normalizedSchedule.intervals) {
      const startMinutes = timeToMinutes(interval.start);
      const endMinutes = timeToMinutes(interval.end);

      if (startMinutes < endMinutes) {
        segments.push({
          day: interval.day,
          startMinutes,
          endMinutes
        });
        continue;
      }

      segments.push({
        day: interval.day,
        startMinutes,
        endMinutes: 1440
      });

      if (endMinutes > 0) {
        segments.push({
          day: (interval.day + 1) % 7,
          startMinutes: 0,
          endMinutes
        });
      }
    }

    return segments;
  }

  function isScheduleActive(schedule, now = Date.now()) {
    const date = new Date(now);
    const day = date.getDay();
    const currentMinutes = (date.getHours() * 60) + date.getMinutes();

    return getExpandedScheduleSegments(schedule).some(segment =>
      segment.day === day &&
      currentMinutes >= segment.startMinutes &&
      currentMinutes < segment.endMinutes
    );
  }

  function getNextScheduleTransition(entries, now = Date.now()) {
    const transitions = normalizeBlockedWebsites(entries, now)
      .filter(entry => (
        entry.status === WEBSITE_BLOCK_STATUS.ACTIVE &&
        entry.type === WEBSITE_BLOCK_TYPE.SCHEDULED &&
        entry.schedule
      ))
      .flatMap(entry => getScheduleTransitions(entry.schedule, now));

    return transitions.length === 0 ? null : Math.min(...transitions);
  }

  function getScheduleTransitions(schedule, now = Date.now()) {
    const normalizedSchedule = normalizeSchedule(schedule);
    if (!normalizedSchedule) return [];

    const date = new Date(now);
    const today = date.getDay();
    const transitions = [];

    for (let dayOffset = -1; dayOffset <= 7; dayOffset++) {
      const day = ((today + dayOffset) % 7 + 7) % 7;
      for (const interval of normalizedSchedule.intervals) {
        if (interval.day !== day) continue;

        const startMinutes = timeToMinutes(interval.start);
        const endMinutes = timeToMinutes(interval.end);
        const startAt = getLocalScheduleTime(date, dayOffset, startMinutes);
        const endDayOffset = endMinutes > startMinutes ? dayOffset : dayOffset + 1;
        const endAt = getLocalScheduleTime(date, endDayOffset, endMinutes);

        if (startAt > now) transitions.push(startAt);
        if (endAt > now) transitions.push(endAt);
      }
    }

    return transitions;
  }

  function getLocalScheduleTime(baseDate, dayOffset, minutes) {
    return new Date(
      baseDate.getFullYear(),
      baseDate.getMonth(),
      baseDate.getDate() + dayOffset,
      Math.floor(minutes / 60),
      minutes % 60,
      0,
      0
    ).getTime();
  }

  function isExpiredEntry(entry, now = Date.now()) {
    if (entry.expiresAt === null || entry.expiresAt === undefined || entry.expiresAt === '') {
      return false;
    }

    const expiresAt = Number(entry.expiresAt);
    return Number.isFinite(expiresAt) && expiresAt <= now;
  }

  function isEntryBlocking(entry, now = Date.now()) {
    if (entry.status !== WEBSITE_BLOCK_STATUS.ACTIVE || isExpiredEntry(entry, now)) {
      return false;
    }

    if (entry.type === WEBSITE_BLOCK_TYPE.SCHEDULED) {
      return !!entry.schedule && isScheduleActive(entry.schedule, now);
    }

    return true;
  }

  function expireEntries(entries, now = Date.now()) {
    const sourceEntries = Array.isArray(entries) ? entries : [];
    const normalizedEntries = normalizeBlockedWebsites(sourceEntries, now);
    let changed = !Array.isArray(entries) || JSON.stringify(sourceEntries) !== JSON.stringify(normalizedEntries);
    const nextEntries = normalizedEntries.map(entry => {
      if (
        entry.status === WEBSITE_BLOCK_STATUS.ACTIVE &&
        entry.type === WEBSITE_BLOCK_TYPE.TEMPORARY &&
        isExpiredEntry(entry, now)
      ) {
        changed = true;
        return {
          ...entry,
          status: WEBSITE_BLOCK_STATUS.INACTIVE,
          updatedAt: now
        };
      }

      return entry;
    });

    return { entries: nextEntries, changed };
  }

  function getNextExpiration(entries, now = Date.now()) {
    const futureExpirations = normalizeBlockedWebsites(entries, now)
      .filter(entry => (
        entry.status === WEBSITE_BLOCK_STATUS.ACTIVE &&
        entry.type === WEBSITE_BLOCK_TYPE.TEMPORARY &&
        Number(entry.expiresAt) > now
      ))
      .map(entry => Number(entry.expiresAt));

    return futureExpirations.length === 0 ? null : Math.min(...futureExpirations);
  }

  function getNextRuleRefreshTime(entries, now = Date.now()) {
    const times = [
      getNextExpiration(entries, now),
      getNextScheduleTransition(entries, now)
    ].filter(Boolean);

    return times.length === 0 ? null : Math.min(...times);
  }

  function isHostnameCoveredByBlock(hostname, blockedHostname) {
    return hostname === blockedHostname || hostname.endsWith(`.${blockedHostname}`);
  }

  function doesEntryMatchInput(entry, input, now = Date.now()) {
    if (!isEntryBlocking(entry, now)) return false;

    const parsed = parseHttpInput(input);
    if (!parsed) return false;

    if (entry.scope === WEBSITE_BLOCK_SCOPE.URL) {
      return parsed.url === entry.url;
    }

    return isHostnameCoveredByBlock(parsed.hostname, entry.hostname);
  }

  function getDisplayTarget(entry) {
    return entry.scope === WEBSITE_BLOCK_SCOPE.URL ? entry.url : entry.hostname;
  }

  function getStatusText(entry, now = Date.now()) {
    if (entry.status === WEBSITE_BLOCK_STATUS.INACTIVE) return 'Paused';
    if (isExpiredEntry(entry, now)) return 'Expired';
    if (entry.type === WEBSITE_BLOCK_TYPE.SCHEDULED) {
      if (!entry.schedule) return 'Missing schedule';
      return isScheduleActive(entry.schedule, now) ? 'Active' : 'Scheduled';
    }

    return 'Active';
  }

  function getTypeText(entry) {
    if (entry.type === WEBSITE_BLOCK_TYPE.TEMPORARY) return 'Temporary';
    if (entry.type === WEBSITE_BLOCK_TYPE.SCHEDULED) return 'Scheduled';
    return 'Permanent';
  }

  function getScopeText(entry) {
    return entry.scope === WEBSITE_BLOCK_SCOPE.URL ? 'URL' : 'Domain';
  }

  function formatExpiresAt(entry, now = Date.now()) {
    if (!entry.expiresAt) return '';
    const remainingMs = Number(entry.expiresAt) - now;
    if (remainingMs <= 0) return 'Expired';

    const minutes = Math.ceil(remainingMs / MINUTE_MS);
    if (minutes < 60) return `${minutes} min`;

    const hours = Math.ceil(minutes / 60);
    if (hours < 48) return `${hours} hr`;

    return `${Math.ceil(hours / 24)} days`;
  }

  function formatSchedule(schedule) {
    const normalizedSchedule = normalizeSchedule(schedule);
    if (!normalizedSchedule) return '';

    return normalizedSchedule.intervals
      .map(interval => `${WEEKDAY_LABELS[interval.day]} ${interval.start}-${interval.end}`)
      .join('; ');
  }

  function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function getDnrCondition(entry) {
    if (entry.scope === WEBSITE_BLOCK_SCOPE.URL) {
      return {
        regexFilter: `^${escapeRegex(entry.url)}$`,
        resourceTypes: ['main_frame']
      };
    }

    return {
      urlFilter: `||${entry.hostname}^`,
      resourceTypes: ['main_frame']
    };
  }

  return {
    STORAGE_KEY,
    SCHEDULES_STORAGE_KEY,
    RULE_REFRESH_ALARM_NAME,
    RULE_RECONCILE_MESSAGE,
    DEFAULT_DURATION_MINUTES,
    WEEKDAY_LABELS,
    createEntry,
    createScheduleDefinition,
    createScheduleFromDays,
    doesEntryMatchInput,
    expireEntries,
    formatExpiresAt,
    formatSchedule,
    getDisplayTarget,
    getDnrCondition,
    getDurationMs,
    getDurationParts,
    getEntryKey,
    getEntryScheduleDefinition,
    getNextExpiration,
    getNextRuleRefreshTime,
    getNextScheduleTransition,
    getScopeText,
    getStatusText,
    getTypeText,
    hydrateEntriesWithSchedules,
    hydrateEntrySchedule,
    isEntryBlocking,
    isExpiredEntry,
    isScheduleActive,
    normalizeBlockInput,
    normalizeBlockedWebsites,
    normalizeSchedule,
    normalizeStoredSchedules,
    parseHttpInput,
    removeEntry,
    removeScheduleDefinition,
    upsertScheduleDefinition,
    upsertEntry
  };
})();
