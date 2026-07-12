const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

process.env.TZ = 'Europe/Warsaw';

const root = path.resolve(__dirname, '..');
const context = vm.createContext({
  URL,
  crypto,
  Date,
  Math,
  console
});

vm.runInContext(fs.readFileSync(path.join(root, 'constants.js'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(root, 'shared.js'), 'utf8'), context);

const { WebsiteBlocker, WEBSITE_BLOCK_TYPE, WEBSITE_BLOCK_STATUS } = context;

function createScheduledEntry(schedule, now) {
  return WebsiteBlocker.createEntry('example.com', {
    type: WEBSITE_BLOCK_TYPE.SCHEDULED,
    status: WEBSITE_BLOCK_STATUS.ACTIVE,
    schedule,
    now
  });
}

test('calculates the spring DST transition using local calendar time', () => {
  const now = new Date(2026, 2, 28, 12, 0).getTime();
  const schedule = WebsiteBlocker.createScheduleFromDays([0], '09:00', '10:00');
  const entry = createScheduledEntry(schedule, now);

  const nextTransition = WebsiteBlocker.getNextScheduleTransition([entry], now);

  assert.equal(nextTransition, new Date(2026, 2, 29, 9, 0).getTime());
});

test('calculates the autumn DST transition using local calendar time', () => {
  const now = new Date(2026, 9, 24, 12, 0).getTime();
  const schedule = WebsiteBlocker.createScheduleFromDays([0], '09:00', '10:00');
  const entry = createScheduledEntry(schedule, now);

  const nextTransition = WebsiteBlocker.getNextScheduleTransition([entry], now);

  assert.equal(nextTransition, new Date(2026, 9, 25, 9, 0).getTime());
});

test('keeps overnight schedule endings correct across DST', () => {
  const now = new Date(2026, 2, 28, 23, 0).getTime();
  const schedule = WebsiteBlocker.createScheduleFromDays([6], '22:00', '06:00');
  const entry = createScheduledEntry(schedule, now);

  const nextTransition = WebsiteBlocker.getNextScheduleTransition([entry], now);

  assert.equal(nextTransition, new Date(2026, 2, 29, 6, 0).getTime());
});

test('marks legacy entries for persistence and keeps the migrated ID stable', () => {
  const now = new Date(2026, 0, 5, 12, 0).getTime();
  const legacyEntries = [{
    hostname: 'example.com',
    status: WEBSITE_BLOCK_STATUS.ACTIVE,
    type: WEBSITE_BLOCK_TYPE.PERMANENT
  }];

  const migration = WebsiteBlocker.expireEntries(legacyEntries, now);
  assert.equal(migration.changed, true);
  assert.ok(migration.entries[0].id);

  const nextRead = WebsiteBlocker.expireEntries(migration.entries, now + 1000);
  assert.equal(nextRead.changed, false);
  assert.equal(nextRead.entries[0].id, migration.entries[0].id);
});
