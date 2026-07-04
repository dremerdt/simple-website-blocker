var WebsiteBlocker = (function () {
  const STORAGE_KEY = 'blockedWebsites';
  const EXPIRATION_ALARM_NAME = 'website-blocker-expiration';
  const DEFAULT_DURATION_MINUTES = 30;
  const MINUTE_MS = 60 * 1000;
  const HOUR_MS = 60 * MINUTE_MS;
  const DAY_MS = 24 * HOUR_MS;

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
    return Number(type) === WEBSITE_BLOCK_TYPE.TEMPORARY
      ? WEBSITE_BLOCK_TYPE.TEMPORARY
      : WEBSITE_BLOCK_TYPE.PERMANENT;
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

  function createEntry(input, options = {}) {
    const scope = normalizeScope(options.scope);
    const blockInput = normalizeBlockInput(input, scope);
    if (!blockInput) return null;

    const now = Number(options.now) || Date.now();
    const type = normalizeType(options.type);
    const durationMs = type === WEBSITE_BLOCK_TYPE.TEMPORARY
      ? Number(options.durationMs)
      : 0;

    if (type === WEBSITE_BLOCK_TYPE.TEMPORARY && (!Number.isFinite(durationMs) || durationMs <= 0)) {
      return null;
    }

    return {
      id: options.id || createId(),
      scope: blockInput.scope,
      hostname: blockInput.hostname,
      url: blockInput.url,
      target: blockInput.target,
      status: normalizeStatus(options.status),
      type,
      createdAt: Number(options.createdAt) || now,
      updatedAt: now,
      expiresAt: type === WEBSITE_BLOCK_TYPE.TEMPORARY ? now + durationMs : null
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
    const type = normalizeType(site.type);
    const expiresAt = Number(site.expiresAt);
    const hasValidExpiration = Number.isFinite(expiresAt) && expiresAt > 0;
    const normalizedType = type === WEBSITE_BLOCK_TYPE.TEMPORARY && hasValidExpiration
      ? WEBSITE_BLOCK_TYPE.TEMPORARY
      : WEBSITE_BLOCK_TYPE.PERMANENT;

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
      expiresAt: normalizedType === WEBSITE_BLOCK_TYPE.TEMPORARY ? expiresAt : null
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

  function isExpiredEntry(entry, now = Date.now()) {
    if (entry.expiresAt === null || entry.expiresAt === undefined || entry.expiresAt === '') {
      return false;
    }

    const expiresAt = Number(entry.expiresAt);
    return Number.isFinite(expiresAt) && expiresAt <= now;
  }

  function isEntryBlocking(entry, now = Date.now()) {
    return entry.status === WEBSITE_BLOCK_STATUS.ACTIVE && !isExpiredEntry(entry, now);
  }

  function expireEntries(entries, now = Date.now()) {
    let changed = false;
    const nextEntries = normalizeBlockedWebsites(entries, now).map(entry => {
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
    if (isExpiredEntry(entry, now)) return 'Expired';
    return entry.status === WEBSITE_BLOCK_STATUS.ACTIVE ? 'Active' : 'Paused';
  }

  function getTypeText(entry) {
    return entry.type === WEBSITE_BLOCK_TYPE.TEMPORARY ? 'Temporary' : 'Permanent';
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
    EXPIRATION_ALARM_NAME,
    DEFAULT_DURATION_MINUTES,
    createEntry,
    doesEntryMatchInput,
    expireEntries,
    formatExpiresAt,
    getDisplayTarget,
    getDnrCondition,
    getDurationMs,
    getDurationParts,
    getEntryKey,
    getNextExpiration,
    getScopeText,
    getStatusText,
    getTypeText,
    isEntryBlocking,
    isExpiredEntry,
    normalizeBlockInput,
    normalizeBlockedWebsites,
    parseHttpInput,
    removeEntry,
    upsertEntry
  };
})();
