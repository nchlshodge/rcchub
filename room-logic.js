// Room reservation logic shared by the website (rooms.html, Admin, Creative
// Timeline) and the Cloud Function that maintains the room schedule.
// (functions/room-logic.js must stay an exact copy of this file.)
//
// What it does: turns an Event Request's room choices into real room ids,
// decides whether a request belongs on the room schedule, and finds clashes.

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RoomLogic = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  // One entry per bookable room. `aliases` are other ways people write it
  // (matched longest-first, so "Kids Sanctuary" never also counts as "Sanctuary").
  // Aliases deliberately include the word "room"/"hall" wherever the bare word
  // is common in event titles ("Early Morning Prayer", "Living Your Best Life",
  // "Preschool Graduation"), so a title only blocks a room when it names it.
  const ROOMS = [
    { id: 'sanctuary',  name: 'Sanctuary',                 aliases: [] },
    { id: 'fellowship', name: 'Fellowship Hall',           aliases: [] },
    { id: 'kitchen',    name: 'Kitchen',                   aliases: [] },
    { id: 'meeting',    name: 'Meeting Room',              aliases: ['college career and married', 'college career married', 'college carrer and married', 'college career', 'married room'] },
    { id: 'prayer',     name: 'Prayer Room',               aliases: [] },
    { id: 'living',     name: 'Living Room',               aliases: [] },
    { id: 'nursingmom', name: "Nursing Mom's Room",        aliases: ['nursing moms room', 'nursing mom', 'nursing moms', 'moms room', 'mothers room'] },
    { id: 'missions',   name: 'Missions Room',             aliases: [] },
    { id: 'green',      name: 'Green Room / Worship Room', aliases: ['green room', 'worship room'] },
    { id: 'cafe',       name: 'Cafe',                      aliases: ['cafe'] },
    { id: 'kidssanct',  name: 'Kids Sanctuary',            aliases: ['kids sanctuary', 'kid sanctuary', "children's sanctuary", 'childrens sanctuary'] },
    { id: 'kidsgame',   name: 'Kids Game Room',            aliases: ['kids game room', 'kids game', 'game room'] },
    { id: 'preschool',  name: 'Preschool Room',            aliases: ['pre school room'] },
    { id: 'kinder',     name: 'Kindergarten Room',         aliases: [] },
    { id: 'nursery',    name: 'Nursery',                   aliases: [] },
    { id: 'kidswork',   name: 'Kids Work Room',            aliases: ['kids work room', 'kid work room', 'kids workroom', 'work room'] },
    { id: 'kids214',    name: 'Kids Classroom 214',        aliases: ['kids classroom 214', 'classroom 214', 'room 214'] },
    { id: 'kids215',    name: 'Kids Classroom 215',        aliases: ['kids classroom 215', 'classroom 215', 'room 215'] },
  ];
  const ALL_IDS = ROOMS.map(r => r.id);
  const BY_ID = Object.fromEntries(ROOMS.map(r => [r.id, r]));

  function norm(s) {
    return String(s == null ? '' : s).toLowerCase()
      .replace(/[‘’']/g, '')          // apostrophes: "mom's" -> "moms"
      .replace(/[^a-z0-9]+/g, ' ').trim();
  }

  // Every phrase that points at a room, longest first.
  const PHRASES = [];
  ROOMS.forEach(r => {
    [r.name].concat(r.aliases).forEach(p => PHRASES.push({ phrase: norm(p), id: r.id }));
  });
  PHRASES.sort((a, b) => b.phrase.length - a.phrase.length);

  // Free text -> room ids. Matched phrases are removed as they are found, so a
  // longer name wins over a shorter one it happens to contain.
  function roomIdsFromText(text) {
    let rest = ' ' + norm(text) + ' ';
    const found = [];
    for (const { phrase, id } of PHRASES) {
      if (!phrase) continue;
      const needle = ' ' + phrase + ' ';
      if (rest.includes(needle)) {
        if (!found.includes(id)) found.push(id);
        rest = rest.split(needle).join(' ');
      }
    }
    return found;
  }

  // An Event Request's room choices -> room ids. "Entire Building" is every room.
  function roomsForRequest(r) {
    const ids = new Set();
    (Array.isArray(r.onsiteRoom) ? r.onsiteRoom : []).forEach(choice => {
      if (/^entire building$/i.test(String(choice).trim())) ALL_IDS.forEach(i => ids.add(i));
      else roomIdsFromText(choice).forEach(i => ids.add(i));
    });
    roomIdsFromText(r.onsiteRoomOther).forEach(i => ids.add(i));
    if (/entire building|whole building|all rooms/i.test(String(r.onsiteRoomOther || ''))) ALL_IDS.forEach(i => ids.add(i));
    return ALL_IDS.filter(i => ids.has(i));
  }

  function toMinutes(t) {
    const m = String(t || '').match(/^(\d{1,2}):(\d{2})/);
    return m ? (+m[1]) * 60 + (+m[2]) : null;
  }

  // Half-open ranges: 9:00-10:00 and 10:00-11:00 do NOT clash.
  function overlaps(aStart, aEnd, bStart, bEnd) {
    return aStart < bEnd && bStart < aEnd;
  }

  // The tidy, privacy-safe record that goes on the room schedule: only an
  // approved event with a date and at least one room qualifies, and it carries
  // no requester name or email. Missing times mean "all day".
  // Every request holds its room as a TBD (tentative) so nobody else double-books
  // it by accident. It only becomes a firm booking when the request is approved
  // AND an admin has explicitly confirmed the room (roomConfirmed === true).
  // Denied requests hold nothing.
  function buildScheduleDoc(eventId, r) {
    const status = r.status || 'new';
    if (status === 'denied') return null;
    // Held somewhere else (an off-site location typed in) = no room here.
    if (r.location && !/rochester christian|\bRCC\b|on.?site|church/i.test(String(r.location))) return null;
    if (!r.eventDate || !/^\d{4}-\d{2}-\d{2}$/.test(String(r.eventDate))) return null;
    const roomIds = roomsForRequest(r);
    if (!roomIds.length) return null;
    const s = toMinutes(r.startTime), e = toMinutes(r.endTime);
    const allDay = s == null;
    const start = allDay ? 0 : s;
    const end = allDay ? 24 * 60 : (e != null && e > s ? e : Math.min(s + 60, 24 * 60));
    return {
      eventId, source: 'eventRequest',
      title: r.eventTitle || r.projectTitle || 'Event',
      roomIds, date: r.eventDate, startMin: start, endMin: end, allDay,
      tentative: status !== 'approved' || r.roomConfirmed !== true,
    };
  }

  // Standing bookings (roomBookings): one-time ("once") or weekly.
  //   { type:'once', date } | { type:'weekly', days:[0-6], from?, until? }
  function bookingAppliesOn(b, dateStr) {
    if (b.type === 'once') return b.date === dateStr;
    if (b.type === 'weekly') {
      if (b.from && dateStr < b.from) return false;
      if (b.until && dateStr > b.until) return false;
      const [y, m, d] = dateStr.split('-').map(Number);
      return (b.days || []).includes(new Date(y, m - 1, d).getDay());
    }
    return false;
  }

  // Everything occupying rooms on one date: schedule docs + standing bookings.
  function occupanciesOn(dateStr, scheduleDocs, bookings) {
    const out = [];
    (scheduleDocs || []).forEach(d => {
      if (d.date === dateStr) out.push({ id: d.eventId || d.id, title: d.title, roomIds: d.roomIds || [], startMin: d.startMin, endMin: d.endMin, allDay: !!d.allDay, kind: d.source === 'calendar' ? 'calendar' : 'event', tentative: d.tentative === true });
    });
    (bookings || []).forEach(b => {
      if (bookingAppliesOn(b, dateStr)) {
        out.push({ id: b.id, title: b.title, roomIds: b.roomIds || [], startMin: b.startMin, endMin: b.endMin, allDay: false, kind: b.type === 'weekly' ? 'weekly' : 'booking', tentative: b.tentative === true });
      }
    });
    // The Staff calendar may hold a hand-added copy of an event that is also an Event Request.
    // Same time + a shared room = the same booking, so count it once.
    return out.filter(o => o.kind !== 'calendar' ||
      !out.some(x => x.kind !== 'calendar' && x.startMin === o.startMin && x.endMin === o.endMin && x.roomIds.some(r => o.roomIds.includes(r))));
  }

  // Clashes between a candidate (an event about to be approved) and what is
  // already booked on its date.
  function findConflicts(candidate, occupancies, ignoreId) {
    if (!candidate) return [];
    return (occupancies || []).filter(o =>
      o.id !== ignoreId &&
      o.roomIds.some(r => candidate.roomIds.includes(r)) &&
      overlaps(candidate.startMin, candidate.endMin, o.startMin, o.endMin)
    ).map(o => ({ ...o, sharedRoomIds: o.roomIds.filter(r => candidate.roomIds.includes(r)),
                  hard: !candidate.tentative && !o.tentative }));
  }

  // Browser helper for the approve buttons and the Event Request form: finds
  // what is already booked in the same room(s) at the same time. Returns
  //   { hard: [...lines], soft: [...lines] }
  // hard = both sides are firm bookings (must not be double-booked);
  // soft = one side is a TBD hold (worth a warning, not a stop).
  // Never throws: a failed lookup must not stop an approval or a submission.
  async function checkApprovalConflicts(db, request, eventId) {
    const none = { hard: [], soft: [] };
    try {
      const candidate = buildScheduleDoc(eventId, Object.assign({}, request, { status: request.status === 'denied' ? 'new' : (request.status || 'approved') }));
      if (!candidate) return none;
      const [sched, book] = await Promise.all([
        db.collection('roomSchedule').where('date', '==', candidate.date).get(),
        db.collection('roomBookings').get(),
      ]);
      const occ = occupanciesOn(candidate.date,
        sched.docs.map(d => Object.assign({ id: d.id }, d.data())),
        book.docs.map(d => Object.assign({ id: d.id }, d.data())));
      const line = c => c.title + (c.tentative ? ' (TBD hold)' : '') + ' — ' + (c.allDay ? 'all day' : fmtMinutes(c.startMin) + ' to ' + fmtMinutes(c.endMin)) +
        ' in ' + c.sharedRoomIds.map(id => BY_ID[id] ? BY_ID[id].name : id).join(', ');
      const found = findConflicts(candidate, occ, eventId);
      return { hard: found.filter(c => c.hard).map(line), soft: found.filter(c => !c.hard).map(line) };
    } catch (e) { return none; }
  }

  // Google Calendar events name their room in the title (and sometimes the
  // location), e.g. "AA Group (Cafe)" or "Young Adults Hangout (Whole Building)".
  function roomsFromCalendarText(text) {
    const t = String(text || '');
    if (/whole building|entire building|all rooms/i.test(t)) return ALL_IDS.slice();
    return roomIdsFromText(t);
  }

  function fmtMinutes(min) {
    const h = Math.floor(min / 60) % 24, m = min % 60;
    return (h % 12 || 12) + ':' + String(m).padStart(2, '0') + ' ' + (h >= 12 ? 'PM' : 'AM');
  }

  return { ROOMS, ALL_IDS, BY_ID, norm, roomIdsFromText, roomsForRequest, toMinutes, overlaps,
           buildScheduleDoc, bookingAppliesOn, occupanciesOn, findConflicts, checkApprovalConflicts, roomsFromCalendarText, fmtMinutes };
});
