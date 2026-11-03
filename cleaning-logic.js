// Cleaning schedule rules shared by the website (cleaning.html) and the Cloud Functions that write the Cleaning calendar.
// (functions/cleaning-logic.js must stay an exact copy of this file.)
//
// What it does: checks and describes a recurring cleaning job, finds the first date it falls on, and works out
// which rooms get setup / tear-down tasks (and how many minutes each takes) from the settings.

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CleaningLogic = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  // Minutes each task takes, unless a room says otherwise: setup before the event, tear-down after it, and a cleaning pass.
  const DEFAULTS = { setupMin: 60, teardownMin: 30, cleanupMin: 30 };
  // Which tasks an event gets when nobody has ticked its boxes: setup before, tear-down and a clean-up after.
  const DEFAULT_TASKS = { setupBefore: true, cleanBefore: false, tearAfter: true, cleanAfter: true };
  const TASK_KINDS = ['setupBefore', 'cleanBefore', 'tearAfter', 'cleanAfter'];
  const OFF_BY_DEFAULT = ['prayer', 'nursingmom', 'green'];   // small rooms that rarely need a crew
  const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const FREQUENCIES = ['daily', 'weekdays', 'weekly', 'monthly'];
  const ISO = /^\d{4}-\d{2}-\d{2}$/;
  const TIME = /^([01]?\d|2[0-3]):([0-5]\d)$/;

  const whole = (v, min, max, fallback) => {
    const n = Number(v);
    return v !== '' && v != null && Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
  };

  // { tasks: boolean, setupMin, teardownMin, cleanupMin } for one room, from settings/cleaning.
  function roomConfig(settings, roomId) {
    const s = settings || {};
    const r = (s.rooms && s.rooms[roomId]) || {};
    const base = (key) => whole(r[key] != null ? r[key] : s[key], 0, 480, DEFAULTS[key]);
    return {
      tasks: r.tasks === undefined ? OFF_BY_DEFAULT.indexOf(roomId) < 0 : r.tasks === true,
      setupMin: base('setupMin'),
      teardownMin: base('teardownMin'),
      cleanupMin: base('cleanupMin'),
    };
  }

  // The rooms of an event that get their own tasks: [{ id, name, cfg }]. A whole-building event is one entry
  // ('whole') that uses the longest time of any room that has tasks on.
  function taskRooms(roomIds, settings, allIds, byId) {
    const on = (roomIds || []).filter(id => roomConfig(settings, id).tasks);
    if (!on.length) return [];
    if ((roomIds || []).length >= allIds.length) {
      const cfgs = on.map(id => roomConfig(settings, id)), most = key => Math.max.apply(null, cfgs.map(c => c[key]));
      return [{ id: 'whole', name: 'Whole Building', cfg: { tasks: true, setupMin: most('setupMin'), teardownMin: most('teardownMin'), cleanupMin: most('cleanupMin') } }];
    }
    return on.map(id => ({ id, name: byId[id] ? byId[id].name : id, cfg: roomConfig(settings, id) }));
  }

  // Which of the four tasks an event needs: { setupBefore, cleanBefore, tearAfter, cleanAfter }. `setup` is the request's setup details.
  function eventTasks(setup) {
    const t = (setup && setup.tasks) || {}, out = {};
    TASK_KINDS.forEach(k => { out[k] = typeof t[k] === 'boolean' ? t[k] : DEFAULT_TASKS[k]; });
    return out;
  }

  const text = v => String(v == null ? '' : v).trim();
  // What was entered for one room of an event: { setupItems, stayUp }.
  function roomDetail(setup, roomId) {
    const r = (setup && setup.rooms && setup.rooms[roomId]) || {};
    return { setupItems: text(r.setupItems), stayUp: text(r.stayUp) };
  }
  // Has anyone said what needs to be set up (the general details, or any room's list)?
  function hasSetupDetails(setup) {
    const s = setup || {};
    if (['headcount', 'chairs', 'tables', 'layout', 'notes'].some(k => text(s[k]))) return true;
    return Object.keys(s.rooms || {}).some(id => text(s.rooms[id] && s.rooms[id].setupItems));
  }

  // The weekdays (0 = Sunday) a weekly job runs on, as a clean sorted list.
  function jobDays(job) {
    const out = [];
    (Array.isArray(job.days) ? job.days : []).forEach(d => { d = Number(d); if (Number.isInteger(d) && d >= 0 && d <= 6 && out.indexOf(d) < 0) out.push(d); });
    return out.sort((a, b) => a - b);
  }

  // '' when the job can go on the calendar, otherwise a sentence saying what to fix.
  function validateJob(job) {
    if (!job || !String(job.title || '').trim()) return 'Give the job a name.';
    if (FREQUENCIES.indexOf(job.frequency) < 0) return 'Choose how often it happens.';
    if (job.frequency === 'weekly' && !jobDays(job).length) return 'Choose at least one day of the week.';
    if (job.frequency === 'monthly') {
      const d = Number(job.monthDay);
      if (!Number.isInteger(d) || d < 1 || d > 28) return 'Choose a day of the month from 1 to 28.';
    }
    if (job.time && !TIME.test(String(job.time))) return 'The time should look like 7:00 AM.';
    if (job.time && job.durationMin != null && job.durationMin !== '' && !(Number(job.durationMin) >= 5)) return 'Say how many minutes the job takes (at least 5).';
    if (job.startDate && !ISO.test(job.startDate)) return 'The start date is not a valid date.';
    if (job.endDate && !ISO.test(job.endDate)) return 'The end date is not a valid date.';
    if (job.startDate && job.endDate && job.endDate < job.startDate) return 'The end date is before the start date.';
    return '';
  }

  function fmt12(t) {
    const m = String(t || '').match(TIME);
    if (!m) return '';
    const h = Number(m[1]);
    return (h % 12 || 12) + ':' + m[2] + ' ' + (h < 12 ? 'AM' : 'PM');
  }

  const nth = n => n + (n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th');

  // "Every Monday and Thursday at 7:00 AM"
  function describeJob(job) {
    let what;
    if (job.frequency === 'daily') what = 'Every day';
    else if (job.frequency === 'weekdays') what = 'Every weekday';
    else if (job.frequency === 'monthly') what = 'The ' + nth(Number(job.monthDay) || 1) + ' of every month';
    else {
      const names = jobDays(job).map(d => DAY_NAMES[d]);
      const list = names.length > 1 ? names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1] : (names[0] || '');
      const every = whole(job.interval, 1, 4, 1);
      what = (every > 1 ? 'Every ' + every + ' weeks on ' : 'Every ') + list;
    }
    return what + (job.time ? ' at ' + fmt12(job.time) : ', all day');
  }

  function dayOf(iso) { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); }
  function isoOf(dt) { return dt.toISOString().slice(0, 10); }

  // Does the job fall on this date (YYYY-MM-DD)?
  function fallsOn(job, iso) {
    const dt = dayOf(iso), wd = dt.getUTCDay();
    if (job.frequency === 'daily') return true;
    if (job.frequency === 'weekdays') return wd >= 1 && wd <= 5;
    if (job.frequency === 'weekly') return jobDays(job).indexOf(wd) >= 0;
    if (job.frequency === 'monthly') return dt.getUTCDate() === Number(job.monthDay);
    return false;
  }

  // The first date on or after `fromIso` (or the job's own start date, if later) that the job falls on.
  function firstOccurrence(job, fromIso) {
    let iso = job.startDate && job.startDate > fromIso ? job.startDate : fromIso;
    let dt = dayOf(iso);
    for (let i = 0; i < 400; i++, dt = new Date(dt.getTime() + 86400000)) {
      if (fallsOn(job, isoOf(dt))) return isoOf(dt);
    }
    return '';
  }

  return { DEFAULTS, DEFAULT_TASKS, TASK_KINDS, OFF_BY_DEFAULT, DAY_NAMES, FREQUENCIES, whole, roomConfig, taskRooms, eventTasks, roomDetail, hasSetupDetails, jobDays, validateJob, fmt12, describeJob, fallsOn, firstOccurrence };
});
