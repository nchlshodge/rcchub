/**
 * Apps Script — Event & Graphic Request Automation (Merged)
 * ============================================================
 *
 * This file combines two things that used to be separate:
 *
 * 1. Your EXISTING automation (onFormSubmit, onStatusEdit,
 *    sendOverdueDigest) — unchanged in behavior, still triggered by
 *    the old Google Form and by manually editing the Status column.
 *
 * 2. The NEW app's webhook (doPost) — receives submissions from the
 *    RCC Hub's Event Request page and now runs through the SAME
 *    notification logic as the Google Form, instead of just silently
 *    appending a row. This is the fix for the gap where app-submitted
 *    requests weren't triggering any staff emails.
 *
 * Both paths now call one shared function, notifyOnNewRequest(),
 * so there is exactly one place that decides who gets emailed and
 * what the starting status is. If you ever need to change who gets
 * notified for graphics vs. van requests, you only need to change it
 * in ONE place now.
 *
 * SETUP: same as before — paste this into the Sheet's Apps Script
 * editor (Extensions → Apps Script), replacing what's there, and
 * redeploy as a Web App if you haven't already (Deploy → New
 * deployment → Web app → Execute as Me → Who has access: Anyone).
 * The existing onFormSubmit/onStatusEdit triggers you already had set
 * up in the Triggers tab do NOT need to be recreated — they'll keep
 * calling the same function names.
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
