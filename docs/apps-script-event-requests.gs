/**
 * ⚠ SUPERSEDED — DO NOT DEPLOY THIS FILE.
 * Use apps-script-merged.gs instead. This older version writes only 30
 * of the sheet's real 32 columns (missing the "I understand" agreement
 * column), so if it's ever pasted into the Apps Script editor and
 * redeployed, every request's data will silently land one column off.
 * It also predates the notifyOnNewRequest() staff-email logic and the
 * WEBHOOK_TOKEN auth check added to the merged version. Kept here only
 * for reference — confirm which script is actually deployed at your
 * Apps Script project's URL, and if it's this one, replace it with
 * apps-script-merged.gs.
 */

/**
 * Apps Script Web App — Event Request Sheet Sync
 * ================================================
 *
 * HOW TO SET THIS UP:
 *
 * 1. Open your existing event-request Google Sheet (the one your
 *    current Google Form already feeds).
 * 2. Extensions → Apps Script.
 * 3. Delete whatever's in the editor and paste this whole file in.
 * 4. Click "Deploy" → "New deployment".
 *    - Type: "Web app"
 *    - Execute as: "Me"
 *    - Who has access: "Anyone" (this is required for the app to be
 *      able to call it — it doesn't expose your Sheet's contents,
 *      only accepts new rows)
 * 5. Click Deploy, authorize the permissions it asks for.
 * 6. Copy the Web App URL it gives you.
 * 7. Paste that URL into event-request.html, replacing
 *    "YOUR_APPS_SCRIPT_WEB_APP_URL" near the top of the <script> tag.
 *
 * That's it — every new submission from the app will now also
 * append a row to this Sheet, matching your existing columns.
 *
 * NOTE: This appends to whatever sheet/tab is ACTIVE when the script
 * runs, which by default is the first tab of the spreadsheet this
 * script is bound to. If your responses live on a specific tab name,
 * change SHEET_NAME below to match it exactly.
 */

var SHEET_NAME = null; // set to a specific tab name (e.g. "Form Responses 1") or leave null to use the first/active sheet

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = SHEET_NAME ? ss.getSheetByName(SHEET_NAME) : ss.getSheets()[0];

    // Column order matches your existing spreadsheet headers exactly.
    var row = [
      data.submittedAt || new Date().toISOString(),   // Timestamp
      data.email || '',                                // Email Address
      requestTypeLabel(data.requestType),               // Request Type
      data.requesterName || '',                         // Requester Name
      (data.department || []).join(', '),               // Ministry Department
      data.eventTitle || '',                             // Event Title
      data.eventDate || '',                              // Event Date Requested
      data.eventDesc || '',                              // Event Details/Description
      data.projectTitle || '',                           // Project/Graphic Title
      joinWithOther(data.mediaSizes, data.mediaSizeOther), // Multimedia Size(s) Needed
      data.mediaDesc || '',                              // Details/Description of what's needed
      data.ticketsNeeded === 'yes' ? 'Yes' : (data.ticketsNeeded === 'no' ? 'No' : ''), // Ticket Sales Needed?
      data.ticketPrice || '',                            // Ticket Price
      joinWithOther(data.marketing, data.marketingOther), // Marketing Requests
      data.location || '',                               // Event Location
      joinWithOther(data.onsiteRoom, data.onsiteRoomOther), // If OnSite what Room
      data.startTime || '',                              // Event Start Time
      data.endTime || '',                                // Event End Time
      'New',                                              // Overall Status (starts as New; update manually as you review)
      '',                                                  // Approved By (Date)
      'No',                                                // Calendar Added?
      '',                                                  // Calendar Due Date
      '',                                                  // Graphic Status
      '',                                                  // Graphic Due Date
      '',                                                  // Marketing Approval
      '',                                                  // Marketing Status
      '',                                                  // Marketing Due Date
      (data.vansNeeded || []).includes('None') || !data.vansNeeded || !data.vansNeeded.length ? 'No' : (data.vansNeeded || []).join(', '), // Van Confirmed?
      '',                                                  // Overdue?
      '',                                                  // Graphic Upload or Link
    ];

    sheet.appendRow(row);

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
