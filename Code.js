/** Public Apps Script entrypoints. Implementation lives under helpers/. */
function processIncomingMail() {
  return processIncomingMail_();
}

function previewIncomingMail() {
  return previewIncomingMail_();
}

function previewBackfill30Days() {
  return previewBackfill30Days_();
}

function backfillLast30Days() {
  return backfillLast30Days_();
}

function previewArchiveBackfill30Days() {
  return previewArchiveBackfill30Days_();
}

function queueArchiveBackfill30Days() {
  return queueArchiveBackfill30Days_();
}

function enableArchiveAutomation() {
  return enableArchiveAutomation_();
}

function disableArchiveAutomation() {
  return disableArchiveAutomation_();
}

function installAutomation() {
  return installAutomation_();
}

function removeAutomation() {
  return removeAutomation_();
}

function testArchivePending() {
  return testArchivePendingWithDelay_(0);
}

function testArchivePendingWithDelay(delayHours) {
  return testArchivePendingWithDelay_(delayHours);
}

