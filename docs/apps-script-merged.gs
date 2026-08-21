/**
 * Apps Script — Event & Graphic Request Automation (Merged)
 * ============================================================
 *
 * This file combines three things:
 *
 * 1. Your EXISTING automation (onFormSubmit, onStatusEdit,
 *    sendOverdueDigest) — unchanged in behavior, still triggered by
 *    the old Google Form and by manually editing the Status column.
 *
 * 2. The app's webhook (doPost) — receives submissions from the
 *    RCC Hub's Event Request page and runs through the SAME
 *    notification logic as the Google Form, instead of just silently
 *    appending a row.
 *
 * 3. Firestore sync (new) — mirrors every row into the same
 *    `eventRequests` Firestore collection the Creative Timeline and
 *    Work Queue pages read from, so requests that still come in
 *    through the OLD Google Form show up there too. App-submitted
 *    requests already write to Firestore directly from
 *    event-request-index.html before this script ever sees them —
 *    doPost just records that row's Firestore doc id in column 33 so
 *    the backfill function below never double-creates it.
 *
 * Both intake paths now call one shared function, notifyOnNewRequest(),
 * so there is exactly one place that decides who gets emailed and
 * what the starting status is.
 *
 * SETUP: same as before — paste this into the Sheet's Apps Script
 * editor (Extensions → Apps Script), replacing what's there, and
 * redeploy as a Web App if you haven't already (Deploy → New
 * deployment → Web app → Execute as Me → Who has access: Anyone).
 * The existing onFormSubmit/onStatusEdit triggers you already had set
 * up in the Triggers tab do NOT need to be recreated — they'll keep
 * calling the same function names.
 *
 * NEW SETUP for the Firestore sync piece:
 *   The sync authenticates by signing in as a fresh anonymous Firebase
 *   user (getAnonymousIdToken_) rather than using your own Google
 *   account's permissions — eventRequests' security rule only checks
 *   "is this a real Firebase Auth session," and this satisfies that
 *   directly, so there's no OAuth scope, IAM role, or service account
 *   to set up. (An earlier version of this file tried using
 *   ScriptApp.getOAuthToken() instead — that's a Google Cloud user
 *   token, a different kind of credential the security rule can never
 *   recognize as signed in, and it always failed with a 403 no matter
 *   what permissions the account had. If you already added a
 *   "datastore" scope to appsscript.json chasing that, it's harmless
 *   to leave in place or remove — it's simply unused now.)
 *
 *   1. In the Sheet itself, add a header in column AG (33), titled
 *      exactly "Firestore Doc ID" — this is bookkeeping only (marks
 *      which rows have already been mirrored into Firestore) and
 *      isn't read by any other page.
 *   2. Save this script, then run backfillEventRequestsToFirestore()
 *      ONCE from the function dropdown at the top of the editor
 *      (▷ Run) to mirror all existing rows. Check the execution log —
 *      it now reports synced / failed / skipped counts separately.
 *   3. From then on, every new Google Form submission mirrors itself
 *      automatically via the same onFormSubmit trigger you already have.
 */

var NICK = "nick@rochesterchristian.church";
var SCOTT = "scott@rochesterchristian.church";
var STEPHANIE = "stephanie@rochesterchristian.church";
var JULIA = "julia@rochesterchristian.church";
var JOSH = "josh@rochesterchristian.church";
var JOSHUA = "joshua@rochesterchristian.church";

var SHEET_NAME = "Form Responses 1"; // change if your tab is named differently

// The web app is deployed "Anyone" access and its URL is visible in the
// Event Request page's own source, so this shared secret is what
// actually stops a stranger from spamming staff emails / filling the
// sheet with junk rows. Set this to a long random string and put the
// same value in event-request-index.html's WEBHOOK_TOKEN constant.
var WEBHOOK_TOKEN = "PASTE_A_LONG_RANDOM_STRING_HERE";

// Google Sheets treats a cell value starting with = + - @ as a formula.
// This endpoint accepts unauthenticated-shaped input (protected only by
// the token above), so every value that lands in a cell must be
// escaped or a submission could run an arbitrary IMPORTXML/HYPERLINK
// formula the moment staff open the sheet.
function sanitizeForSheet(value) {
  var str = (value === null || value === undefined) ? '' : String(value);
  return /^[=+\-@]/.test(str) ? "'" + str : str;
}

// ============================================================
// SHARED NOTIFICATION LOGIC
// Both the Google Form path and the new app's webhook path call this
// with the same normalized fields, so behavior is identical either way.
// ============================================================
function notifyOnNewRequest(fields) {
  // fields is a plain object with: requestType, requesterName,
  // department, eventTitle, van, graphicSizes, marketing

  var summary = "Requester: " + fields.requesterName + "\nDepartment: " + fields.department +
                "\nRequest Type: " + fields.requestType + "\nTitle: " + fields.eventTitle;

  MailApp.sendEmail(NICK, "Approval Needed: " + fields.eventTitle,
    "A new request needs your approval.\n\n" + summary);

  if (fields.requestType === "Event with Graphics" || fields.requestType === "Event Only (no graphics needed)" ||
      fields.requestType === "Church Event (goes on church calendar and has a graphic)") {
    MailApp.sendEmail(STEPHANIE, "Add to Calendar: " + fields.eventTitle,
      "This event needs to be added to the calendar with a description.\n\n" + summary);
  }

  if (fields.van === "Yes" || (fields.van && fields.van !== "None" && fields.van !== "")) {
    MailApp.sendEmail(NICK + "," + SCOTT, "Van Requested: " + fields.eventTitle,
      "A church van has been requested.\n\n" + summary);
  }

  if (fields.graphicSizes) {
    MailApp.sendEmail(JULIA + "," + JOSH, "New Graphic Request: " + fields.eventTitle,
      "A graphic has been requested.\nSize(s): " + fields.graphicSizes + "\n\n" + summary);
  }

  if (fields.marketing && fields.marketing.indexOf("None") === -1 && fields.marketing !== "") {
    MailApp.sendEmail(JOSHUA + "," + JULIA, "Marketing Request: " + fields.eventTitle,
      "Marketing has been requested: " + fields.marketing + "\n\n" + summary);
  }
}

// ============================================================
// PATH 1: Google Form submissions (unchanged trigger, same as before)
// ============================================================
function onFormSubmit(e) {
  var responses = e.namedValues;
  var sheet = e.range.getSheet();
  var row = e.range.getRow();
  sheet.getRange(row, 21).setValue("Pending Approval"); // column U = Overall Status

  function get(title) {
    return responses[title] ? responses[title][0] : "";
  }

  var fields = {
    requestType: get("Request Type"),
    requesterName: get("Requester Name"),
    department: get("Ministry Department"),
    eventTitle: get("Event Title") || get("Project/Graphic Title") || "(untitled request)",
    van: get("Church Van Needed?"),
    graphicSizes: get("Graphic Size(s) Needed"),
    marketing: get("Marketing Requests"),
  };

  notifyOnNewRequest(fields);

  // Mirror this brand-new row into Firestore so it shows up in the
  // Creative Timeline / Work Queue immediately, same as an app submission.
  try {
    syncRowToFirestoreByRowNumber_(sheet, row, getAnonymousIdToken_());
  } catch (err) {
    Logger.log("Firestore sync setup failed for row " + row + ": " + err.message);
  }
}

// ============================================================
// PATH 2: New app webhook (RCC Hub's Event Request page)
// ============================================================
function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);

    if (WEBHOOK_TOKEN === "PASTE_A_LONG_RANDOM_STRING_HERE" || data.token !== WEBHOOK_TOKEN) {
      return ContentService.createTextOutput(JSON.stringify({success:false, error: 'Unauthorized'}))
        .setMimeType(ContentService.MimeType.JSON);
    }

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = SHEET_NAME ? ss.getSheetByName(SHEET_NAME) : ss.getSheets()[0];

    var requestTypeLabel_ = requestTypeLabel(data.requestType);
    var vanLabel = joinWithOther(data.vansNeeded, null);
    var mediaSizesLabel = joinWithOther(data.mediaSizes, data.mediaSizeOther);
    var marketingLabel = joinWithOther(data.marketing, data.marketingOther);

    // Column order matches your existing spreadsheet headers exactly
    // (verified against the real 32-column header row, including the
    // "I understand" agreement column that sits between Marketing
    // Requests and Event Location — easy to miss since it's not an
    // obviously-named field, but everything after it shifts by one
    // column if it's skipped).
    var row = [
      data.submittedAt || new Date().toISOString(),   // 1. Timestamp
      sanitizeForSheet(data.email),                     // 2. Email Address
      sanitizeForSheet(requestTypeLabel_),              // 3. Request Type
      sanitizeForSheet(data.requesterName),             // 4. Requester Name
      sanitizeForSheet((data.department || []).join(', ')), // 5. Ministry Department
      sanitizeForSheet(data.eventTitle),                // 6. Event Title
      sanitizeForSheet(data.eventDate),                 // 7. Event Date Requested
      sanitizeForSheet(data.eventDesc),                 // 8. Event Details/Description
      sanitizeForSheet(data.projectTitle),              // 9. Project/Graphic Title
      sanitizeForSheet(mediaSizesLabel),                // 10. Multimedia Size(s) Needed
      sanitizeForSheet(data.mediaDesc),                 // 11. Details/Description of what's needed
      sanitizeForSheet(vanLabel || 'None'),             // 12. Church Van Needed?
      data.ticketsNeeded === 'yes' ? 'Yes' : (data.ticketsNeeded === 'no' ? 'No' : ''), // 13. Ticket Sales Needed?
      sanitizeForSheet(data.ticketPrice),               // 14. Ticket Price
      sanitizeForSheet(marketingLabel),                 // 15. Marketing Requests
      'I understand',                                     // 16. Agreement column — form already required this checkbox before submit
      sanitizeForSheet(data.location),                  // 17. Event Location
      sanitizeForSheet(joinWithOther(data.onsiteRoom, data.onsiteRoomOther)), // 18. If OnSite what Room
      sanitizeForSheet(data.startTime),                 // 19. Event Start Time
      sanitizeForSheet(data.endTime),                   // 20. Event End Time
      'Pending Approval',                                 // 21. Overall Status — matches the Form path's starting status
      '',                                                  // 22. Approved By (Date)
      '',                                                  // 23. Calendar Added? (matches real data: blank until set, not defaulted to "No")
      '',                                                  // 24. Calendar Due Date
      '',                                                  // 25. Graphic Status
      '',                                                  // 26. Graphic Due Date
      '',                                                  // 27. Marketing Approval
      '',                                                  // 28. Marketing Status
      '',                                                  // 29. Marketing Due Date
      '',                                                  // 30. Van Confirmed? (blank until admin confirms, matches real data pattern)
      '',                                                  // 31. Overdue?
      '',                                                  // 32. Graphic Upload or Link
      sanitizeForSheet(data.id || ''),                  // 33. Firestore Doc ID — this row's doc already
                                                             // exists (created client-side before this webhook
                                                             // ran); recording it here stops the backfill
                                                             // function from ever creating a duplicate.
    ];

    sheet.appendRow(row);

    // Run the SAME notification logic the Google Form path uses, so
    // app-submitted requests alert staff exactly like Form ones do.
    notifyOnNewRequest({
      requestType: requestTypeLabel_,
      requesterName: data.requesterName || '',
      department: (data.department || []).join(', '),
      eventTitle: data.eventTitle || data.projectTitle || '(untitled request)',
      van: vanLabel,
      graphicSizes: mediaSizesLabel,
      marketing: marketingLabel,
    });

    return ContentService.createTextOutput(JSON.stringify({success:true}))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({success:false, error: err.message}))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function requestTypeLabel(type) {
  if (type === 'church_event') return 'Church Event (goes on church calendar and has a graphic)';
  if (type === 'media_only') return 'Media/Graphic Only (no event, no church calendar)';
  if (type === 'facilities') return 'Facilities Rental (no graphic needed, no church calendar)';
  return type || '';
}

function joinWithOther(arr, otherText) {
  var items = (arr || []).slice();
  if (otherText) {
    var idx = items.indexOf('Other');
    if (idx > -1) items[idx] = 'Other: ' + otherText;
  }
  return items.join(', ');
}

// ============================================================
// Firestore sync — mirrors Sheet rows into the same `eventRequests`
// collection the Creative Timeline / Work Queue pages read from. See
// the NEW SETUP block in the file header comment before running any
// of this for the first time.
// ============================================================
var FIRESTORE_PROJECT_ID = "bedsidercc";
var FIRESTORE_DOC_ID_COL = 33; // column AG — add a "Firestore Doc ID" header here

// Same public Web API key already embedded in event-request-index.html
// and work-queue.html's firebaseConfig — this is not a secret, it just
// identifies which Firebase project to talk to.
var FIREBASE_WEB_API_KEY = "AIzaSyDFX7_fLi82PqkSUK7mi4bRzOPF1efcAeE";

// Signs in as a fresh anonymous Firebase Auth user and returns its ID
// token. This is the piece that was missing: eventRequests' security
// rule is `allow create: if isSignedIn()`, which checks for a real
// Firebase Auth session — a Google Cloud OAuth token from
// ScriptApp.getOAuthToken() is a different kind of credential and can
// never satisfy that, no matter what IAM role the account running the
// script has. Signing in anonymously first gets a token the rule
// actually recognizes, without needing a service account or any new
// permission grant.
function getAnonymousIdToken_() {
  var url = "https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=" + FIREBASE_WEB_API_KEY;
  var res = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify({ returnSecureToken: true }),
    muteHttpExceptions: true,
  });
  var code = res.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error("Anonymous Firebase sign-in failed (" + code + "): " + res.getContentText());
  }
  return JSON.parse(res.getContentText()).idToken;
}

function firestoreValue_(v) {
  if (v === null || v === undefined || v === '') return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return { doubleValue: v };
  if (Object.prototype.toString.call(v) === '[object Date]') return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(firestoreValue_) } };
  return { stringValue: String(v) };
}

function firestoreFields_(obj) {
  var fields = {};
  Object.keys(obj).forEach(function (k) { fields[k] = firestoreValue_(obj[k]); });
  return fields;
}

// Creates one eventRequests document via the Firestore REST API,
// authenticated as the anonymous Firebase user idToken belongs to
// (see getAnonymousIdToken_ above).
function createEventRequestDoc_(obj, idToken) {
  var url = "https://firestore.googleapis.com/v1/projects/" + FIRESTORE_PROJECT_ID + "/databases/(default)/documents/eventRequests";
  var res = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    headers: { Authorization: "Bearer " + idToken },
    payload: JSON.stringify({ fields: firestoreFields_(obj) }),
    muteHttpExceptions: true,
  });
  var code = res.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error("Firestore write failed (" + code + "): " + res.getContentText());
  }
  var body = JSON.parse(res.getContentText());
  var parts = body.name.split("/"); // ".../documents/eventRequests/<id>"
  return parts[parts.length - 1];
}

// The old form's four historical "Request Type" labels, mapped to the
// same enum the Hub's own Event Request page writes.
function parseRequestTypeFromLabel_(label) {
  label = (label || '').toString();
  if (label.indexOf('Church Event') === 0) return 'church_event';
  if (label.indexOf('Facilities Rental') === 0) return 'facilities';
  return 'media_only'; // covers both "Graphic Only..." and "Media/Graphic Only..."
}

function splitList_(str) {
  str = (str || '').toString().trim();
  if (!str || str === 'None') return [];
  return str.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
}

// The Hub's own schema uses '' for not-started; the Sheet has used
// "Not Started" and "Not Yet Started" interchangeably over time.
function normalizeStatus_(status) {
  if (status === 'Completed') return 'Completed';
  if (status === 'In Progress') return 'In Progress';
  return '';
}

function toDateString_(val) {
  if (!val) return '';
  if (Object.prototype.toString.call(val) === '[object Date]') {
    return Utilities.formatDate(val, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return String(val);
}

function toTimeString_(val) {
  if (!val) return '';
  if (Object.prototype.toString.call(val) === '[object Date]') {
    return Utilities.formatDate(val, Session.getScriptTimeZone(), 'HH:mm');
  }
  return String(val);
}

// Subtracts `days` from a "YYYY-MM-DD" string, returning the same
// format — same logic as event-request-index.html's subtractDays_, kept
// in sync so both intake paths compute the same default the same way.
function subtractDays_(dateStr, days) {
  if (!dateStr) return '';
  var parts = dateStr.split('-').map(Number);
  var d = new Date(parts[0], parts[1] - 1, parts[2]);
  d.setDate(d.getDate() - days);
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

// Maps one 32-column Sheet row (see the column map in doPost above)
// into the exact document shape event-request-index.html writes, so
// both intake paths produce identical Firestore documents.
function mapRowToEventRequest_(row) {
  var overallStatus = row[20]; // col 21
  var eventDate = toDateString_(row[6]);
  var mediaSizes = splitList_(row[9]);
  var graphicDueDate = toDateString_(row[25]);
  // Same default lead time as the app's own form: 6 weeks before the
  // event, only filled in when the Sheet didn't already have one.
  if (!graphicDueDate && mediaSizes.length && eventDate) {
    graphicDueDate = subtractDays_(eventDate, 42);
  }
  return {
    email: row[1] || '',
    requesterName: row[3] || '',
    requestType: parseRequestTypeFromLabel_(row[2]),
    department: splitList_(row[4]),
    eventTitle: row[5] || '',
    eventDesc: row[7] || '',
    eventDate: eventDate,
    startTime: toTimeString_(row[18]),
    endTime: toTimeString_(row[19]),
    location: row[16] || '',
    onsiteRoom: splitList_(row[17]),
    projectTitle: row[8] || '',
    mediaSizes: mediaSizes,
    mediaDesc: row[10] || '',
    vansNeeded: splitList_(row[11]),
    ticketsNeeded: row[12] === 'Yes' ? 'yes' : (row[12] === 'No' ? 'no' : ''),
    ticketPrice: row[13] || '',
    marketing: splitList_(row[14]),
    status: overallStatus === 'Approved' ? 'approved' : (overallStatus === 'Denied' ? 'denied' : 'new'),
    calendarAdded: /Google Cal|PC Cal/.test(row[22] || ''),
    graphicStatus: normalizeStatus_(row[24]),
    graphicDueDate: graphicDueDate,
    marketingStatus: normalizeStatus_(row[27]),
    marketingDueDate: toDateString_(row[28]),
    vanConfirmed: row[29] === 'Yes',
    graphicLink: row[31] || '',
    submittedAt: (Object.prototype.toString.call(row[0]) === '[object Date]') ? row[0] : new Date(),
  };
}

// Syncs one row by number, skipping it if it already has a Firestore
// doc id recorded (so re-running the backfill is always safe). Wrapped
// in try/catch so a Firestore hiccup never breaks onFormSubmit's emails.
// Returns true on an actual successful write, false otherwise — callers
// should count THIS, not just "did we attempt it."
function syncRowToFirestoreByRowNumber_(sheet, rowNum, idToken) {
  try {
    var lastCol = Math.max(sheet.getLastColumn(), FIRESTORE_DOC_ID_COL);
    var row = sheet.getRange(rowNum, 1, 1, lastCol).getValues()[0];
    if (row[FIRESTORE_DOC_ID_COL - 1]) return false; // already synced
    var docId = createEventRequestDoc_(mapRowToEventRequest_(row), idToken);
    sheet.getRange(rowNum, FIRESTORE_DOC_ID_COL).setValue(docId);
    return true;
  } catch (err) {
    Logger.log("Firestore sync failed for row " + rowNum + ": " + err.message);
    return false;
  }
}

// Run this ONCE by hand (▷ Run, in the Apps Script editor's function
// dropdown) to mirror every existing row into Firestore. Safe to
// re-run any time afterward — rows with a Firestore Doc ID already
// filled in are skipped, so nothing gets duplicated.
function backfillEventRequestsToFirestore() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  var lastRow = sheet.getLastRow();
  var idToken = getAnonymousIdToken_();
  var synced = 0, skipped = 0, failed = 0;
  for (var r = 2; r <= lastRow; r++) {
    if (sheet.getRange(r, FIRESTORE_DOC_ID_COL).getValue()) { skipped++; continue; }
    if (!sheet.getRange(r, 4).getValue()) { skipped++; continue; } // blank Requester Name = blank row
    if (syncRowToFirestoreByRowNumber_(sheet, r, idToken)) { synced++; } else { failed++; }
  }
  Logger.log("Backfill complete: " + synced + " synced, " + failed + " failed, " + skipped + " skipped.");
}

// Updates ONE field on an already-existing eventRequests document —
// unlike createEventRequestDoc_, this never creates a new document, so
// it's safe to use for fixing up rows that were synced before some
// default (like the 6-week graphic due date) existed.
function patchEventRequestField_(docId, fieldName, value, idToken) {
  var url = "https://firestore.googleapis.com/v1/projects/" + FIRESTORE_PROJECT_ID +
    "/databases/(default)/documents/eventRequests/" + docId +
    "?updateMask.fieldPaths=" + encodeURIComponent(fieldName);
  var patch = {};
  patch[fieldName] = value;
  var res = UrlFetchApp.fetch(url, {
    method: "patch",
    contentType: "application/json",
    headers: { Authorization: "Bearer " + idToken },
    payload: JSON.stringify({ fields: firestoreFields_(patch) }),
    muteHttpExceptions: true,
  });
  var code = res.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error("Firestore patch failed (" + code + "): " + res.getContentText());
  }
}

// Run this ONCE to backfill the 6-week-before-event graphic due date
// onto rows that were already synced to Firestore before that default
// existed. Only touches rows that (a) already have a Firestore Doc ID
// and (b) still have a blank Graphic Due Date in the Sheet — it will
// never overwrite a due date someone already set, and never creates a
// new document. Also fills in the Sheet's own Graphic Due Date column
// (Z) so both sides stay consistent.
function patchMissingGraphicDueDates() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  var lastRow = sheet.getLastRow();
  var idToken = getAnonymousIdToken_();
  var patched = 0, skipped = 0, failed = 0;
  for (var r = 2; r <= lastRow; r++) {
    var docId = sheet.getRange(r, FIRESTORE_DOC_ID_COL).getValue();
    if (!docId) { skipped++; continue; } // never synced — run the backfill for these instead

    var lastCol = Math.max(sheet.getLastColumn(), FIRESTORE_DOC_ID_COL);
    var row = sheet.getRange(r, 1, 1, lastCol).getValues()[0];
    var existingDue = toDateString_(row[25]);
    var mediaSizes = splitList_(row[9]);
    var eventDate = toDateString_(row[6]);
    if (existingDue || !mediaSizes.length || !eventDate) { skipped++; continue; }

    var newDue = subtractDays_(eventDate, 42);
    try {
      patchEventRequestField_(docId, 'graphicDueDate', newDue, idToken);
      sheet.getRange(r, 26).setValue(newDue); // column Z — Graphic Due Date
      patched++;
    } catch (err) {
      Logger.log("Patch failed for row " + r + " (doc " + docId + "): " + err.message);
      failed++;
    }
  }
  Logger.log("Patched " + patched + " rows, " + failed + " failed, " + skipped + " skipped.");
}

// ============================================================
// Status column edits — unchanged from before. Fires whether the row
// came from the Google Form OR the new app, since it's triggered by
// editing the Status column itself, not by how the row was created.
// ============================================================
function onStatusEdit(e) {
  var sheet = e.range.getSheet();
  if (sheet.getName() !== SHEET_NAME) return;

  var statusCol = 21; // column U
  if (e.range.getColumn() !== statusCol) return;

  var newStatus = e.value;
  if (newStatus !== "Approved" && newStatus !== "Denied") return;

  var row = e.range.getRow();
  if (row === 1) return;

  if (newStatus === "Approved") {
    sheet.getRange(row, 22).setValue(new Date()); // column V = Approved By (Date)
  }

  var data = sheet.getRange(row, 1, 1, sheet.getLastColumn()).getValues()[0];

  var requesterEmail = data[1];
  var requestType = data[2];
  var requesterName = data[3];
  var eventTitle = data[5] || data[8] || "your request";
  var graphicSizes = data[9];
  var van = data[11];
  var marketing = data[14];

  if (requesterEmail) {
    var subject, body;
    if (newStatus === "Approved") {
      subject = "Your request has been approved: " + eventTitle;
      body = "Hi " + requesterName + ",\n\nGood news — your request \"" + eventTitle +
             "\" has been approved.\n\nYou'll be contacted separately if anything further is needed. Thanks!";
    } else {
      subject = "Update on your request: " + eventTitle;
      body = "Hi " + requesterName + ",\n\nYour request \"" + eventTitle +
             "\" was not approved at this time.\n\nReach out if you have questions or want to resubmit with changes.";
    }
    MailApp.sendEmail(requesterEmail, subject, body);
  }

  if (newStatus === "Denied") {
    var standDownRecipients = [];

    if (requestType === "Event with Graphics" || requestType === "Event Only (no graphics needed)" ||
        requestType === "Church Event (goes on church calendar and has a graphic)") {
      standDownRecipients.push(STEPHANIE);
    }
    if (van === "Yes" || (van && van !== "None" && van !== "" && van !== "No")) {
      standDownRecipients.push(SCOTT);
    }
    if (graphicSizes) {
      standDownRecipients.push(JULIA, JOSH);
    }
    if (marketing && marketing.indexOf("None") === -1 && marketing !== "") {
      standDownRecipients.push(JOSHUA, JULIA);
    }

    standDownRecipients = standDownRecipients.filter(function (email, index) {
      return standDownRecipients.indexOf(email) === index;
    });

    if (standDownRecipients.length > 0) {
      MailApp.sendEmail(standDownRecipients.join(","), "Stand Down — Request Denied: " + eventTitle,
        "Heads up: the request \"" + eventTitle + "\" (Requester: " + requesterName +
        ") has been denied. No further action needed on your end.");
    }
  }
}

// ============================================================
// Overdue digest — unchanged from before.
// ============================================================
function sendOverdueDigest() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  var data = sheet.getDataRange().getValues();
  var headers = data[0];

  function colIndex(name) {
    return headers.indexOf(name);
  }

  var overdueCol = colIndex("Overdue?");
  var titleCol = colIndex("Event Title") !== -1 ? colIndex("Event Title") : colIndex("Project/Graphic Title");
  var requesterCol = colIndex("Requester Name");
  var statusCol = colIndex("Overall Status");
  var calDueCol = colIndex("Calendar Due Date");
  var graphicDueCol = colIndex("Graphic Due Date");
  var marketingDueCol = colIndex("Marketing Due Date");

  if (overdueCol === -1) {
    Logger.log("Could not find an 'Overdue?' column — check header spelling.");
    return;
  }

  var overdueRows = [];
  for (var i = 1; i < data.length; i++) {
    if (data[i][overdueCol] === "⚠ OVERDUE") {
      overdueRows.push(data[i]);
    }
  }

  if (overdueRows.length === 0) return;

  var lines = overdueRows.map(function (row) {
    var title = titleCol !== -1 ? row[titleCol] : "(untitled)";
    var requester = requesterCol !== -1 ? row[requesterCol] : "";
    var status = statusCol !== -1 ? row[statusCol] : "";
    var dueDates = [];
    if (calDueCol !== -1 && row[calDueCol]) dueDates.push("Calendar due " + row[calDueCol]);
    if (graphicDueCol !== -1 && row[graphicDueCol]) dueDates.push("Graphic due " + row[graphicDueCol]);
    if (marketingDueCol !== -1 && row[marketingDueCol]) dueDates.push("Marketing due " + row[marketingDueCol]);
    return "- " + title + " (Requester: " + requester + ", Status: " + status + ") " +
           (dueDates.length ? "[" + dueDates.join("; ") + "]" : "");
  });

  var body = "The following requests are overdue:\n\n" + lines.join("\n") +
             "\n\nOpen the Dashboard tab in the Response Database sheet for full detail.";

  MailApp.sendEmail(NICK, overdueRows.length + " Overdue Request(s) — Daily Digest", body);
}
