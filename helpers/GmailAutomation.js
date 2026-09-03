const AUTOMATION = Object.freeze({
  cursorProperty: 'GMAIL_LABELER_CURSOR_MS',
  startProperty: 'GMAIL_LABELER_START_MS',
  archiveEnabledProperty: 'GMAIL_LABELER_ARCHIVE_ENABLED',
  archivePendingLabel: 'Automation/Archive Pending',
  triggerFunction: 'processIncomingMail',
  overlapMs: 10 * 60 * 1000,
  previewLookbackMs: 24 * 60 * 60 * 1000,
  backfillLookbackMs: 30 * 24 * 60 * 60 * 1000,
  archiveDelayMs: 24 * 60 * 60 * 1000,
  pageSize: 100,
  maxMessagesPerRun: 500,
});

function processIncomingMail_() {
  return withAutomationLock_(() => {
    const properties = PropertiesService.getScriptProperties();
    const cursorValue = properties.getProperty(AUTOMATION.cursorProperty);
    const startValue = properties.getProperty(AUTOMATION.startProperty);
    if (!cursorValue || !startValue) {
      const now = Date.now();
      properties.setProperties({
        [AUTOMATION.cursorProperty]: String(now),
        [AUTOMATION.startProperty]: String(now),
      });
      const initialized = {
        scanned: 0,
        matched: 0,
        archived: 0,
        unmatched: 0,
        archiveEligible: 0,
        queued: 0,
        initialized: true,
      };
      console.log(JSON.stringify(initialized));
      return initialized;
    }

    const runStartedAt = Date.now();
    const archiveEnabled = isArchiveEnabled_(properties);
    const scanAfterMs = Math.max(Number(startValue), Number(cursorValue) - AUTOMATION.overlapMs);
    const decisions = getInboxDecisionsSince_(scanAfterMs);
    const labelIds = getOrCreateRequiredLabelIds_();
    const pendingLabelId = archiveEnabled ? getOrCreateArchivePendingLabelId_(labelIds) : null;
    const queued = applyLabelDecisions_(decisions, labelIds, {
      manageArchiveQueue: archiveEnabled,
      pendingLabelId,
    });
    const archiveResult = archiveEnabled
      ? processPendingArchives_(pendingLabelId, runStartedAt)
      : { archived: 0, pending: 0, cleared: 0 };
    const immediateArchived = processImmediateArchives_(labelIds);

    properties.setProperty(AUTOMATION.cursorProperty, String(runStartedAt));
    const result = {
      ...summarizeDecisions_(decisions),
      queued,
      archived: archiveResult.archived + immediateArchived,
      immediateArchived,
      pending: archiveResult.pending,
      cleared: archiveResult.cleared,
      archiveEnabled,
    };
    console.log(JSON.stringify(result));
    return result;
  });
}

function previewIncomingMail_() {
  const properties = PropertiesService.getScriptProperties();
  const cursorValue = properties.getProperty(AUTOMATION.cursorProperty);
  const startValue = properties.getProperty(AUTOMATION.startProperty);
  const now = Date.now();
  const scanAfterMs = cursorValue && startValue
    ? Math.max(Number(startValue), Number(cursorValue) - AUTOMATION.overlapMs)
    : now - AUTOMATION.previewLookbackMs;

  const result = buildPreviewResult_(getInboxDecisionsSince_(scanAfterMs), now);
  console.log(JSON.stringify(result));
  return result;
}

function previewBackfill30Days_() {
  const now = Date.now();
  const result = {
    days: 30,
    ...buildPreviewResult_(getInboxDecisionsSince_(now - AUTOMATION.backfillLookbackMs), now),
  };
  console.log(JSON.stringify(result));
  return result;
}

function backfillLast30Days_() {
  return withAutomationLock_(() => {
    const now = Date.now();
    const decisions = getInboxDecisionsSince_(now - AUTOMATION.backfillLookbackMs);
    const labelIds = getOrCreateRequiredLabelIds_();
    applyLabelDecisions_(decisions, labelIds, { manageArchiveQueue: false, pendingLabelId: null });
    const result = { days: 30, ...summarizeDecisions_(decisions), labelCounts: countLabels_(decisions) };
    console.log(JSON.stringify(result));
    return result;
  });
}

function previewArchiveBackfill30Days_() {
  const now = Date.now();
  const decisions = getInboxDecisionsSince_(now - AUTOMATION.backfillLookbackMs);
  const candidates = decisions.filter(decision => decision.archiveEligible);
  const result = {
    days: 30,
    scanned: decisions.length,
    candidates: candidates.length,
    protected: decisions.filter(decision => !decision.archiveEligible).length,
    archiveEnabled: isArchiveEnabled_(PropertiesService.getScriptProperties()),
    messages: candidates.map(decision => archiveCandidateView_(decision, now)),
  };
  console.log(JSON.stringify(result));
  return result;
}

function queueArchiveBackfill30Days_() {
  return withAutomationLock_(() => {
    const properties = PropertiesService.getScriptProperties();
    if (!isArchiveEnabled_(properties)) {
      throw new Error('Archive automation is disabled. Run enableArchiveAutomation first.');
    }

    const now = Date.now();
    const decisions = getInboxDecisionsSince_(now - AUTOMATION.backfillLookbackMs);
    const labelIds = getOrCreateRequiredLabelIds_();
    const pendingLabelId = getOrCreateArchivePendingLabelId_(labelIds);
    const queued = applyLabelDecisions_(decisions, labelIds, {
      manageArchiveQueue: true,
      pendingLabelId,
    });
    const result = {
      days: 30,
      ...summarizeDecisions_(decisions),
      queued,
      archived: 0,
      note: 'Eligible messages are queued. Due messages archive on next successful trigger.',
    };
    console.log(JSON.stringify(result));
    return result;
  });
}

function enableArchiveAutomation_() {
  return withAutomationLock_(() => {
    const labelIds = getOrCreateRequiredLabelIds_();
    getOrCreateArchivePendingLabelId_(labelIds);
    PropertiesService.getScriptProperties().setProperty(AUTOMATION.archiveEnabledProperty, 'true');
    const result = { archiveEnabled: true, delayHours: AUTOMATION.archiveDelayMs / 3600000 };
    console.log(JSON.stringify(result));
    return result;
  });
}

function disableArchiveAutomation_() {
  return withAutomationLock_(() => {
    PropertiesService.getScriptProperties().setProperty(AUTOMATION.archiveEnabledProperty, 'false');
    const cleared = clearArchiveQueue_();
    const result = { archiveEnabled: false, cleared };
    console.log(JSON.stringify(result));
    return result;
  });
}

function installAutomation_() {
  return withAutomationLock_(() => {
    getOrCreateRequiredLabelIds_();
    removeProcessorTriggers_();
    const now = Date.now();
    PropertiesService.getScriptProperties().setProperties({
      [AUTOMATION.cursorProperty]: String(now),
      [AUTOMATION.startProperty]: String(now),
    });
    ScriptApp.newTrigger(AUTOMATION.triggerFunction).timeBased().everyMinutes(5).create();
    const result = {
      installed: true,
      intervalMinutes: 5,
      archiveEnabled: isArchiveEnabled_(PropertiesService.getScriptProperties()),
    };
    console.log(JSON.stringify(result));
    return result;
  });
}

function removeAutomation_() {
  return withAutomationLock_(() => {
    const properties = PropertiesService.getScriptProperties();
    properties.setProperty(AUTOMATION.archiveEnabledProperty, 'false');
    const result = { removedTriggers: removeProcessorTriggers_(), clearedArchiveQueue: clearArchiveQueue_() };
    console.log(JSON.stringify(result));
    return result;
  });
}

function withAutomationLock_(operation) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) {
    const skipped = { skipped: true, reason: 'another Gmail automation run is active' };
    console.log(JSON.stringify(skipped));
    return skipped;
  }
  try {
    return operation();
  } finally {
    lock.releaseLock();
  }
}

function removeProcessorTriggers_() {
  let removed = 0;
  ScriptApp.getProjectTriggers().forEach(trigger => {
    if (trigger.getHandlerFunction() === AUTOMATION.triggerFunction) {
      ScriptApp.deleteTrigger(trigger);
      removed += 1;
    }
  });
  return removed;
}

function isArchiveEnabled_(properties) {
  return properties.getProperty(AUTOMATION.archiveEnabledProperty) === 'true';
}

function getInboxDecisionsSince_(afterMs) {
  const labelNamesById = getLabelNamesById_();
  return listMessagesByQuery_(
    `in:inbox -in:spam -in:trash after:${Math.floor(afterMs / 1000)}`,
    true
  ).map(message => buildDecision_(getMessageMetadata_(message.id, labelNamesById)));
}

function buildPreviewResult_(decisions, nowMs) {
  return {
    ...summarizeDecisions_(decisions),
    labelCounts: countLabels_(decisions),
    candidates: decisions
      .filter(decision => decision.labelNames.length > 0)
      .map(decision => ({
        id: decision.id,
        from: decision.from,
        subject: decision.subject,
        labels: decision.labelNames,
        archiveEligible: decision.archiveEligible,
        archiveImmediately: decision.archiveImmediately,
        archiveReason: decision.archiveReason,
        archiveDue: isArchiveDue_(decision, nowMs, AUTOMATION.archiveDelayMs),
      })),
  };
}

function archiveCandidateView_(decision, nowMs) {
  const internalDateMs = Number(decision.internalDate);
  const ageHours = Number.isFinite(internalDateMs)
    ? Math.max(0, Math.floor((nowMs - internalDateMs) / 3600000))
    : null;
  return {
    id: decision.id,
    from: decision.from,
    subject: decision.subject,
    labels: decision.labelNames,
    reason: decision.archiveReason,
    immediate: decision.archiveImmediately,
    ageHours,
    archiveDue: isArchiveDue_(decision, nowMs, AUTOMATION.archiveDelayMs),
  };
}

function listMessagesByQuery_(query, failWhenOverLimit, labelIds = []) {
  const messages = [];
  let pageToken;
  do {
    const remaining = AUTOMATION.maxMessagesPerRun - messages.length;
    if (remaining <= 0) {
      if (failWhenOverLimit) {
        throw new Error(`Safety limit exceeded: more than ${AUTOMATION.maxMessagesPerRun} messages.`);
      }
      break;
    }
    const options = { maxResults: Math.min(AUTOMATION.pageSize, remaining) };
    if (query) options.q = query;
    if (labelIds.length) options.labelIds = labelIds;
    if (pageToken) options.pageToken = pageToken;
    const page = Gmail.Users.Messages.list('me', options);
    messages.push(...(page.messages || []));
    pageToken = page.nextPageToken;
  } while (pageToken);
  return messages;
}

function getMessageMetadata_(messageId, labelNamesById = {}) {
  const message = Gmail.Users.Messages.get('me', messageId, {
    format: 'metadata',
    metadataHeaders: ['From', 'Subject', 'Cc'],
  });
  const headers = {};
  ((message.payload && message.payload.headers) || []).forEach(header => {
    headers[String(header.name).toLowerCase()] = header.value || '';
  });
  return {
    id: message.id,
    from: headers.from || '',
    cc: headers.cc || '',
    subject: headers.subject || '',
    snippet: message.snippet || '',
    internalDate: message.internalDate || '',
    gmailLabelIds: message.labelIds || [],
    existingLabelNames: (message.labelIds || [])
      .map(labelId => labelNamesById[labelId])
      .filter(Boolean),
  };
}

function getOrCreateRequiredLabelIds_() {
  const idsByName = getLabelIdsByName_();
  Object.values(LABELS).filter(name => !idsByName[name]).forEach(name => {
    const label = Gmail.Users.Labels.create({
      name,
      labelListVisibility: 'labelShow',
      messageListVisibility: 'show',
    }, 'me');
    idsByName[name] = label.id;
  });
  return idsByName;
}

function getOrCreateArchivePendingLabelId_(idsByName) {
  if (idsByName[AUTOMATION.archivePendingLabel]) return idsByName[AUTOMATION.archivePendingLabel];
  const label = Gmail.Users.Labels.create({
    name: AUTOMATION.archivePendingLabel,
    labelListVisibility: 'labelHide',
    messageListVisibility: 'hide',
  }, 'me');
  idsByName[AUTOMATION.archivePendingLabel] = label.id;
  return label.id;
}

function getLabelIdsByName_() {
  const idsByName = {};
  (Gmail.Users.Labels.list('me').labels || []).forEach(label => {
    idsByName[label.name] = label.id;
  });
  return idsByName;
}

function getLabelNamesById_() {
  const namesById = {};
  (Gmail.Users.Labels.list('me').labels || []).forEach(label => {
    namesById[label.id] = label.name;
  });
  return namesById;
}

function applyLabelDecisions_(decisions, labelIds, options) {
  let queued = 0;
  const mutations = decisions
    .filter(decision => decision.labelNames.length > 0)
    .map(decision => {
      const addLabelIds = decision.labelNames.map(name => labelIds[name]);
      const removeLabelIds = [];
      if (options.manageArchiveQueue) {
        if (decision.archiveEligible) {
          addLabelIds.push(options.pendingLabelId);
          if (!decision.gmailLabelIds.includes(options.pendingLabelId)) queued += 1;
        } else if (decision.gmailLabelIds.includes(options.pendingLabelId)) {
          removeLabelIds.push(options.pendingLabelId);
        }
      }
      return { id: decision.id, addLabelIds, removeLabelIds };
    });
  applyMessageMutations_(mutations);
  return queued;
}

function processPendingArchives_(pendingLabelId, nowMs) {
  const pendingMessages = listMessagesByQuery_('-in:spam -in:trash', false, [pendingLabelId]);
  const labelNamesById = getLabelNamesById_();
  const archiveMutations = [];
  const cleanupMutations = [];
  let pending = 0;

  pendingMessages.forEach(message => {
    const decision = buildDecision_(getMessageMetadata_(message.id, labelNamesById));
    if (!decision.gmailLabelIds.includes('INBOX') || !decision.archiveEligible) {
      cleanupMutations.push({ id: decision.id, addLabelIds: [], removeLabelIds: [pendingLabelId] });
    } else if (isArchiveDue_(decision, nowMs, AUTOMATION.archiveDelayMs)) {
      archiveMutations.push({
        id: decision.id,
        addLabelIds: [],
        removeLabelIds: ['INBOX', pendingLabelId],
      });
    } else {
      pending += 1;
    }
  });

  applyMessageMutations_([...archiveMutations, ...cleanupMutations]);
  return { archived: archiveMutations.length, pending, cleared: cleanupMutations.length };
}

function processImmediateArchives_(labelIds) {
  const messages = listMessagesByQuery_(
    'in:inbox from:notifications@github.com {"[bot]" cc:ci_activity@noreply.github.com} -in:spam -in:trash',
    false
  );
  const labelNamesById = getLabelNamesById_();
  const pendingLabelId = labelIds[AUTOMATION.archivePendingLabel];
  const mutations = messages
    .map(message => buildDecision_(getMessageMetadata_(message.id, labelNamesById)))
    .filter(decision => decision.archiveImmediately && decision.gmailLabelIds.includes('INBOX'))
    .map(decision => ({
      id: decision.id,
      addLabelIds: decision.labelNames.map(name => labelIds[name]),
      removeLabelIds: pendingLabelId ? ['INBOX', pendingLabelId] : ['INBOX'],
    }));
  applyMessageMutations_(mutations);
  return mutations.length;
}

function clearArchiveQueue_() {
  const labelIds = getLabelIdsByName_();
  const pendingLabelId = labelIds[AUTOMATION.archivePendingLabel];
  if (!pendingLabelId) return 0;
  const pendingMessages = listMessagesByQuery_('', false, [pendingLabelId]);
  applyMessageMutations_(pendingMessages.map(message => ({
    id: message.id,
    addLabelIds: [],
    removeLabelIds: [pendingLabelId],
  })));
  return pendingMessages.length;
}

function applyMessageMutations_(mutations) {
  const groups = new Map();
  mutations.forEach(mutation => {
    const addLabelIds = Array.from(new Set(mutation.addLabelIds)).sort();
    const removeLabelIds = Array.from(new Set(mutation.removeLabelIds)).sort();
    if (!addLabelIds.length && !removeLabelIds.length) return;
    const key = JSON.stringify({ addLabelIds, removeLabelIds });
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(mutation.id);
  });

  groups.forEach((ids, key) => {
    const labels = JSON.parse(key);
    Gmail.Users.Messages.batchModify({ ids, ...labels }, 'me');
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { AUTOMATION, applyMessageMutations_ };
}
