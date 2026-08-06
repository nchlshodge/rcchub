/**
 * Apps Script — Time Off Request Automation
 * ============================================================
 *
 * Handles two things, both arriving as POST requests from the RCC
 * Hub's Time Off Request page and its admin screen:
 *
 * 1. NEW SUBMISSION (default, no "action" field sent)
 *    - Appends a row to this Sheet, matching the columns below.
 *    - Emails whichever address(es) are currently configured in the
 *      app's admin settings (Time Off > Notification Emails) — those
 *      are sent along with each request, so this script never needs
 *      editing when the notification email changes.
 *
 * 2. STATUS CHANGE (action: "statusChanged", sent when an admin
 *    clicks Approve/Deny inside the app)
 *    - Emails the requester directly, letting them know the outcome.
 *    - Does NOT touch the Sheet — the row was already written at
 *      submission time; approving/denying in the app doesn't
 *      currently update that row's values in the Sheet. If you also
 *      want the Sheet's row updated on approval, see the note near
 *      updateSheetRowStatus() below.
 *
 * SETUP:
 * 1. Open your time-off Google Sheet.
 * 2. Extensions → Apps Script, paste this whole file in (replacing
 *    anything there).
 * 3. Check SHEET_NAME below matches your actual tab name.
 * 4. Deploy → New deployment → Web app → Execute as: Me →
 *    Who has access: Anyone → Deploy. Authorize when prompted.
 * 5. Copy the Web App URL.
 * 6. Paste that URL into BOTH:
 *    - time-off.html's SHEET_SYNC_URL variable
 *    - admin.html's TIME_OFF_WEBHOOK_URL variable
 *    (same URL in both places — one script handles both directions.)
 */

var SHEET_NAME = "Form Responses 1"; // change to match your actual tab name

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);

    if (data.action === 'statusChanged') {
      return handleStatusChange(data);
    }
    return handleNewSubmission(data);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({success:false, error: err.message}))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function handleNewSubmission(data) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME) || ss.getSheets()[0];

  var row = [
    data.submittedAt || new Date().toISOString(), // Timestamp
    data.name || '',                               // Name
    data.startDate || '',                          // Beginning On
    data.endDate || '',                            // Ending On
    data.officeReturnDate || '',                   // Office Return Date
    data.amountOff || '',                          // How many days/hours off
    data.coverage || '',                           // Who's covering
    data.requestType || '',                        // Type of Request
    'Pending',                                      // Status (your own tracking column, if you have one — adjust position if needed)
    data.email || '',                               // Requester email (for reference)
  ];
  sheet.appendRow(row);

  // Email whichever address(es) are currently set in the app.
  var recipients = [data.notifyEmail1, data.notifyEmail2].filter(function(e){ return e; });
  if (recipients.length > 0) {
    var subject = "Time Off Request: " + data.name;
    var body = "A new time off request has been submitted.\n\n" +
      "Name: " + data.name + "\n" +
      "Type: " + data.requestType + "\n" +
      "Dates: " + data.startDate + " to " + data.endDate + "\n" +
      "Amount off: " + data.amountOff + "\n" +
      "Coverage: " + data.coverage + "\n\n" +
      "Review it in the RCC Hub admin screen under Time Off.";
    MailApp.sendEmail(recipients.join(","), subject, body);
  }

  return ContentService.createTextOutput(JSON.stringify({success:true}))
    .setMimeType(ContentService.MimeType.JSON);
}

function handleStatusChange(data) {
  if (data.requesterEmail) {
    var subject, body;
    if (data.status === 'approved') {
      subject = "Your time off request has been approved";
      body = "Hi " + (data.requesterName || '') + ",\n\n" +
        "Your time off request (" + data.startDate + " to " + data.endDate + ") has been approved.\n\n" +
        "Enjoy your time away!";
    } else if (data.status === 'denied') {
      subject = "Update on your time off request";
      body = "Hi " + (data.requesterName || '') + ",\n\n" +
        "Your time off request (" + data.startDate + " to " + data.endDate + ") was not approved at this time.\n\n" +
        "Reach out if you have questions.";
    } else {
      // status moved back to pending or something else — no email needed
      return ContentService.createTextOutput(JSON.stringify({success:true, note:'no email sent for this status'}))
        .setMimeType(ContentService.MimeType.JSON);
    }
    MailApp.sendEmail(data.requesterEmail, subject, body);
  }

  // NOTE: this does not update the Sheet's Status column for the
  // matching row. If you want that too, you'd need to find the row
  // (e.g. by matching requestId or email+dates) and call
  // sheet.getRange(row, statusCol).setValue(...) — ask if you want
  // this added; it's a reasonable next step but wasn't in the
  // original request.

  return ContentService.createTextOutput(JSON.stringify({success:true}))
    .setMimeType(ContentService.MimeType.JSON);
}
