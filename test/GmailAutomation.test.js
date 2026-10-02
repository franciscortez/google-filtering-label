const test = require('node:test');
const assert = require('node:assert/strict');

const {
  applyMessageMutations_,
  backfillAtomeTransactions30Days_,
  backfillOnlineJobsApplications_,
  getInboxDecisionsSince_,
  getOnlineJobsBackfillDecisions_,
  previewAtomeBackfill30Days_,
  previewOnlineJobsApplications_,
  processPendingArchives_,
} = require('../helpers/GmailAutomation.js');
const classifier = require('../helpers/Classifier.js');

test('archive mutation removes only Inbox and pending labels', () => {
  const calls = [];
  global.Gmail = {
    Users: {
      Messages: {
        batchModify(body, userId) {
          calls.push({ body, userId });
        },
      },
    },
  };

  try {
    applyMessageMutations_([{
      id: 'message-1',
      addLabelIds: [],
      removeLabelIds: ['INBOX', 'Label_pending', 'INBOX'],
    }]);
  } finally {
    delete global.Gmail;
  }

  assert.deepEqual(calls, [{
    body: {
      ids: ['message-1'],
      addLabelIds: [],
      removeLabelIds: ['INBOX', 'Label_pending'],
    },
    userId: 'me',
  }]);
  assert.equal(calls[0].body.removeLabelIds.includes('UNREAD'), false);
});

function withOnlineJobsMailbox(options, operation) {
  const labelIds = Object.fromEntries(Object.values(classifier.LABELS)
    .map((name, index) => [name, `Label_${index}`]));
  labelIds['Automation/Archive Pending'] = 'Label_pending';
  if (options.missingChild) delete labelIds[classifier.LABELS.onlineJobsApplications];
  const childId = labelIds[classifier.LABELS.onlineJobsApplications];
  const messages = options.messages || {
    seed: { threadId: 'application', from: 'OnlineJobs.ph <support@onlinejobs.ph>',
      subject: 'Application for Backend Developer', labelIds: ['UNREAD', 'Label_pending'] },
    reply: { threadId: 'application', from: 'manager@example.com',
      subject: 'Re: Next steps', labelIds: ['INBOX', 'UNREAD', 'STARRED', labelIds[classifier.LABELS.reading]] },
    sent: { threadId: 'application', from: 'applicant@gmail.com',
      subject: 'Re: Next steps', labelIds: ['SENT'] },
    spam: { threadId: 'application', from: 'manager@example.com', subject: 'Re: Next steps', labelIds: ['SPAM'] },
    trash: { threadId: 'application', from: 'manager@example.com', subject: 'Re: Next steps', labelIds: ['TRASH'] },
    draft: { threadId: 'application', from: 'applicant@gmail.com', subject: 'Re: Next steps', labelIds: ['DRAFT'] },
    oldChild: { threadId: 'verified', from: 'manager@example.com',
      subject: 'Next steps', labelIds: childId ? [childId] : [] },
    laterReply: { threadId: 'verified', from: 'manager@example.com',
      subject: 'Re: Next steps', labelIds: ['INBOX', 'UNREAD'] },
    newsletter: { threadId: 'newsletter', from: 'support@onlinejobs.ph',
      subject: 'Application tips and new jobs', labelIds: ['INBOX', 'UNREAD'] },
    unrelated: { threadId: 'unrelated', from: 'manager@example.com',
      subject: 'Another project', labelIds: ['INBOX', 'UNREAD'] },
  };
  const calls = { queries: [], threadReads: [], labelCreates: [], mutations: [], locks: 0, releases: 0 };
  const metadata = id => ({
    id,
    threadId: messages[id].threadId,
    internalDate: String(Date.UTC(2020, 0, 1)),
    labelIds: [...messages[id].labelIds],
    snippet: messages[id].snippet || '',
    payload: { headers: [
      { name: 'From', value: messages[id].from },
      { name: 'Subject', value: messages[id].subject },
    ] },
  });
  const globals = {
    ...classifier,
    Gmail: { Users: {
      Labels: {
        list: () => ({ labels: Object.entries(labelIds).map(([name, id]) => ({ name, id })) }),
        create(body) {
          calls.labelCreates.push(body);
          const id = `Created_${calls.labelCreates.length}`;
          labelIds[body.name] = id;
          return { id, name: body.name };
        },
      },
      Messages: {
        list(_userId, queryOptions) {
          calls.queries.push(queryOptions);
          const candidateIds = options.candidateIds || Object.keys(messages).filter(id => {
            const message = messages[id];
            if (message.labelIds.some(label => ['SPAM', 'TRASH', 'DRAFT'].includes(label))) return false;
            if (queryOptions.labelIds) return queryOptions.labelIds.every(label => message.labelIds.includes(label));
            if (queryOptions.q.includes('in:inbox')) return message.labelIds.includes('INBOX');
            return classifier.extractEmailAddress_(message.from) === 'support@onlinejobs.ph'
              && /\bapplication\b/i.test(message.subject);
          });
          const start = Number(queryOptions.pageToken || 0);
          const end = start + queryOptions.maxResults;
          return {
            messages: candidateIds.slice(start, end).map(id => ({ id, threadId: messages[id].threadId })),
            ...(end < candidateIds.length ? { nextPageToken: String(end) } : {}),
          };
        },
        get: (_userId, id) => metadata(id),
        batchModify(body) {
          calls.mutations.push(body);
          body.ids.forEach(id => {
            const next = new Set(messages[id].labelIds);
            body.addLabelIds.forEach(labelId => next.add(labelId));
            body.removeLabelIds.forEach(labelId => next.delete(labelId));
            messages[id].labelIds = [...next];
          });
        },
      },
      Threads: {
        get(_userId, threadId) {
          calls.threadReads.push(threadId);
          return { id: threadId, messages: Object.keys(messages)
            .filter(id => messages[id].threadId === threadId).map(metadata) };
        },
      },
    } },
    LockService: { getScriptLock: () => ({
      tryLock() { calls.locks += 1; return true; },
      releaseLock() { calls.releases += 1; },
    }) },
    PropertiesService: { getScriptProperties() { throw new Error('OnlineJobs operations must not access properties'); } },
  };
  const previous = Object.fromEntries(Object.keys(globals).map(name => [name, global[name]]));
  const previousLog = console.log;
  Object.assign(global, globals);
  console.log = () => {};
  try {
    return operation({ messages, labelIds, calls });
  } finally {
    console.log = previousLog;
    Object.entries(previous).forEach(([name, value]) => {
      if (value === undefined) delete global[name];
      else global[name] = value;
    });
  }
}

test('OnlineJobs preview covers archived history and sent replies without mailbox writes', () => {
  withOnlineJobsMailbox({}, ({ calls, labelIds }) => {
    const preview = previewOnlineJobsApplications_();
    assert.deepEqual(preview.candidates.map(message => message.id).sort(),
      ['seed', 'reply', 'sent', 'oldChild', 'laterReply'].sort());
    assert.equal(preview.candidates.every(message => !message.archiveEligible), true);
    assert.match(calls.queries[0].q, /from:support@onlinejobs\.ph/);
    assert.match(calls.queries[0].q, /subject:application/);
    assert.deepEqual(calls.queries[1].labelIds, [labelIds[classifier.LABELS.onlineJobsApplications]]);
    assert.match(calls.queries[0].q, /-in:spam/);
    assert.match(calls.queries[0].q, /-in:trash/);
    assert.doesNotMatch(calls.queries[0].q, /in:inbox|after:|newer_than:/);
    assert.deepEqual(calls.labelCreates, []);
    assert.deepEqual(calls.mutations, []);
    assert.equal(calls.locks, 0);
    assert.equal(calls.threadReads.filter(id => id === 'application').length, 1);
  });
});

test('OnlineJobs backfill preserves mailbox state, clears pending and reruns without duplicate writes', () => {
  withOnlineJobsMailbox({}, ({ messages, labelIds, calls }) => {
    const original = Object.fromEntries(Object.entries(messages).map(([id, message]) => [id, [...message.labelIds]]));
    const result = backfillOnlineJobsApplications_();
    assert.equal(result.matched, 5);
    const required = [labelIds[classifier.LABELS.applications], labelIds[classifier.LABELS.onlineJobsApplications]];
    for (const id of ['seed', 'reply', 'sent', 'oldChild', 'laterReply']) {
      required.forEach(labelId => assert.equal(messages[id].labelIds.includes(labelId), true, `${id}: ${labelId}`));
      const expected = new Set([...original[id].filter(labelId => labelId !== 'Label_pending'), ...required]);
      assert.deepEqual(new Set(messages[id].labelIds), expected, id);
    }
    for (const id of ['spam', 'trash', 'draft', 'newsletter', 'unrelated']) {
      assert.deepEqual(messages[id].labelIds, original[id], id);
    }
    assert.equal(calls.locks, 1);
    assert.equal(calls.releases, 1);
    const writes = calls.mutations.length;
    backfillOnlineJobsApplications_();
    assert.equal(calls.mutations.length, writes);
    assert.equal(calls.locks, 2);
    assert.equal(calls.releases, 2);
  });
});

test('OnlineJobs child label is created only during backfill when missing', () => {
  withOnlineJobsMailbox({ missingChild: true }, ({ calls, labelIds }) => {
    previewOnlineJobsApplications_();
    assert.deepEqual(calls.labelCreates, []);
    backfillOnlineJobsApplications_();
    assert.deepEqual(calls.labelCreates.map(label => label.name), [classifier.LABELS.onlineJobsApplications]);
    assert.ok(labelIds[classifier.LABELS.onlineJobsApplications]);
  });
});

test('targeted OnlineJobs backfill adds destination labels without applying unrelated classifier labels', () => {
  withOnlineJobsMailbox({}, ({ messages, labelIds, calls }) => {
    messages.reply.subject = 'Action required: confirm your interview';
    const preview = previewOnlineJobsApplications_();
    const reply = preview.candidates.find(message => message.id === 'reply');
    assert.deepEqual(reply.labels, [classifier.LABELS.applications, classifier.LABELS.onlineJobsApplications]);
    backfillOnlineJobsApplications_();
    assert.equal(messages.reply.labelIds.includes(labelIds[classifier.LABELS.action]), false);
    assert.equal(calls.mutations.every(mutation => mutation.addLabelIds.every(id =>
      [labelIds[classifier.LABELS.applications], labelIds[classifier.LABELS.onlineJobsApplications]].includes(id))), true);
  });
});

test('future Inbox reply is recognized through cached verified thread without labeling unrelated mail', () => {
  withOnlineJobsMailbox({}, ({ calls, messages }) => {
    messages.seed.labelIds.push('INBOX');
    const decisions = getInboxDecisionsSince_(Date.UTC(2026, 0, 1));
    const required = [classifier.LABELS.applications, classifier.LABELS.onlineJobsApplications].sort();
    for (const id of ['reply', 'seed', 'laterReply']) {
      const decision = decisions.find(message => message.id === id);
      assert.ok(decision);
      assert.equal(decision.onlineJobsApplicationThread, true);
      assert.equal(decision.archiveEligible, false);
      assert.deepEqual(decision.labelNames, required);
    }
    assert.deepEqual(decisions.find(message => message.id === 'unrelated').labelNames, []);
    assert.equal(calls.threadReads.filter(id => id === 'application').length, 1);
  });
});

test('pending OnlineJobs employer replies are rechecked and removed from archive queue without archiving', () => {
  withOnlineJobsMailbox({}, ({ messages, calls }) => {
    messages.reply.labelIds.push('Label_pending');
    const result = processPendingArchives_('Label_pending', Date.now());
    assert.equal(result.archived, 0);
    assert.equal(result.cleared, 2);
    assert.equal(messages.reply.labelIds.includes('Label_pending'), false);
    assert.equal(messages.reply.labelIds.includes('INBOX'), true);
    assert.equal(messages.reply.labelIds.includes('UNREAD'), true);
    assert.equal(messages.reply.labelIds.includes('STARRED'), true);
    assert.equal(calls.mutations.every(mutation =>
      mutation.removeLabelIds.every(id => id === 'Label_pending')), true);
    assert.equal(calls.threadReads.filter(id => id === 'application').length, 1);
  });
});

test('excluded thread members cannot establish OnlineJobs application context', () => {
  for (const excludedLabel of ['SPAM', 'TRASH', 'DRAFT']) {
    const messages = {
      excludedSeed: { threadId: 'unverified', from: 'support@onlinejobs.ph',
        subject: 'Application for Developer', labelIds: [excludedLabel] },
      reply: { threadId: 'unverified', from: 'manager@example.com',
        subject: 'Re: Next steps', labelIds: ['INBOX'] },
    };
    withOnlineJobsMailbox({ messages, candidateIds: ['reply'] }, () => {
      const decisions = getOnlineJobsBackfillDecisions_();
      assert.deepEqual(decisions, [], excludedLabel);
      const inbox = getInboxDecisionsSince_(0);
      assert.deepEqual(inbox[0].labelNames, [], excludedLabel);
    });
  }
});

test('OnlineJobs expanded history exceeding 500 messages fails before labels or message mutations', () => {
  const messages = {
    seed: { threadId: 'large', from: 'support@onlinejobs.ph',
      subject: 'Application for Developer', labelIds: [] },
  };
  for (let index = 0; index < 500; index += 1) {
    messages[`reply-${index}`] = { threadId: 'large', from: 'manager@example.com',
      subject: 'Re: Next steps', labelIds: ['SENT'] };
  }
  withOnlineJobsMailbox({ messages, candidateIds: ['seed'], missingChild: true }, ({ calls }) => {
    assert.throws(() => backfillOnlineJobsApplications_(), /Safety limit exceeded: more than 500 messages\./);
    assert.deepEqual(calls.labelCreates, []);
    assert.deepEqual(calls.mutations, []);
    assert.equal(calls.releases, 1);
  });
});

test('OnlineJobs seed search exceeding 500 references fails before thread reads or mailbox writes', () => {
  const messages = {};
  for (let index = 0; index < 501; index += 1) {
    messages[`seed-${index}`] = { threadId: `application-${index}`, from: 'support@onlinejobs.ph',
      subject: 'Application for Developer', labelIds: [] };
  }
  withOnlineJobsMailbox({ messages, missingChild: true }, ({ calls }) => {
    assert.throws(() => backfillOnlineJobsApplications_(), /Safety limit exceeded: more than 500 messages\./);
    assert.equal(calls.queries.length, 5);
    assert.ok(calls.queries.at(-1).pageToken);
    assert.deepEqual(calls.threadReads, []);
    assert.deepEqual(calls.labelCreates, []);
    assert.deepEqual(calls.mutations, []);
    assert.equal(calls.releases, 1);
  });
});

test('OnlineJobs preview accepts exactly 500 unique messages and deduplicates repeated thread references', () => {
  const messages = {
    seed: { threadId: 'large', from: 'support@onlinejobs.ph',
      subject: 'Application for Developer', labelIds: [] },
  };
  for (let index = 0; index < 499; index += 1) {
    messages[`reply-${index}`] = { threadId: 'large', from: 'manager@example.com',
      subject: 'Re: Next steps', labelIds: ['SENT'] };
  }
  withOnlineJobsMailbox({ messages, candidateIds: ['seed', 'seed'] }, ({ calls }) => {
    const preview = previewOnlineJobsApplications_();
    assert.equal(preview.matched, 500);
    assert.equal(new Set(preview.candidates.map(message => message.id)).size, 500);
    assert.equal(calls.threadReads.length, 1);
    assert.deepEqual(calls.labelCreates, []);
    assert.deepEqual(calls.mutations, []);
  });
});

test('message mutations batch identical label operations', () => {
  const calls = [];
  global.Gmail = {
    Users: {
      Messages: {
        batchModify(body) {
          calls.push(body);
        },
      },
    },
  };

  try {
    applyMessageMutations_([
      { id: 'one', addLabelIds: ['Label_1'], removeLabelIds: [] },
      { id: 'two', addLabelIds: ['Label_1'], removeLabelIds: [] },
      { id: 'three', addLabelIds: [], removeLabelIds: [] },
    ]);
  } finally {
    delete global.Gmail;
  }

  assert.deepEqual(calls, [{
    ids: ['one', 'two'],
    addLabelIds: ['Label_1'],
    removeLabelIds: [],
  }]);
});

test('Atome backfill previews and labels only trusted transaction mail', () => {
  const labelIds = Object.fromEntries(Object.values(classifier.LABELS)
    .map((name, index) => [name, `Label_${index}`]));
  const messages = {
    success: {
      from: 'Atome <no-reply@service.atome.ph>',
      subject: 'Transaction Confirmation: Example Store',
      snippet: 'Your payment of PHP 100.00 using your Atome Card has been successfully processed.',
      labelIds: ['INBOX'],
    },
    failure: {
      from: 'Atome <alerts@service.atome.ph>',
      subject: 'Card Transaction Declined',
      snippet: '',
      labelIds: ['INBOX'],
    },
    alreadyLabeled: {
      from: 'Atome <no-reply@service.atome.ph>',
      subject: 'Payment Confirmation: Example Cafe',
      snippet: '',
      labelIds: ['INBOX', labelIds[classifier.LABELS.transactions]],
    },
    verification: {
      from: 'Atome <no-reply@service.atome.ph>',
      subject: 'Atome Email Verification Code',
      snippet: 'Enter the code in the Atome App.',
      labelIds: ['INBOX'],
    },
    lookalike: {
      from: 'Atome <no-reply@atome.ph.example.com>',
      subject: 'Transaction Confirmation: Example Store',
      snippet: '',
      labelIds: ['INBOX'],
    },
  };
  const calls = [];
  const previous = Object.fromEntries(['Gmail', 'LockService', 'LABELS', 'buildDecision_', 'isAtomeSender_', 'isOnlineJobsApplication_', 'summarizeDecisions_', 'countLabels_', 'isArchiveDue_']
    .map(name => [name, global[name]]));
  const previousLog = console.log;
  Object.assign(global, {
    ...Object.fromEntries(['LABELS', 'buildDecision_', 'isAtomeSender_', 'isOnlineJobsApplication_', 'summarizeDecisions_', 'countLabels_', 'isArchiveDue_']
      .map(name => [name, classifier[name]])),
    Gmail: {
      Users: {
        Labels: { list: () => ({ labels: Object.entries(labelIds).map(([name, id]) => ({ name, id })) }) },
        Messages: {
          list(_userId, options) {
            assert.match(options.q, /in:inbox from:\(atome\.ph\)/);
            return { messages: Object.keys(messages).map(id => ({ id })) };
          },
          get(_userId, id) {
            const message = messages[id];
            return {
              id,
              labelIds: message.labelIds,
              snippet: message.snippet,
              payload: { headers: [
                { name: 'From', value: message.from },
                { name: 'Subject', value: message.subject },
              ] },
            };
          },
          batchModify(body) { calls.push(body); },
        },
      },
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
  });
  console.log = () => {};

  try {
    const preview = previewAtomeBackfill30Days_();
    assert.deepEqual(preview.candidates.map(candidate => candidate.id), ['success', 'failure', 'alreadyLabeled']);
    assert.equal(preview.candidates.every(candidate => !candidate.archiveEligible), true);
    assert.deepEqual(calls, []);

    const result = backfillAtomeTransactions30Days_();
    assert.equal(result.matched, 3);
    assert.deepEqual(calls, [
      { ids: ['success'], addLabelIds: [labelIds[classifier.LABELS.transactions]], removeLabelIds: [] },
      { ids: ['failure'], addLabelIds: [labelIds[classifier.LABELS.action], labelIds[classifier.LABELS.transactions]].sort(), removeLabelIds: [] },
    ]);
  } finally {
    console.log = previousLog;
    Object.entries(previous).forEach(([name, value]) => {
      if (value === undefined) delete global[name];
      else global[name] = value;
    });
  }
});
