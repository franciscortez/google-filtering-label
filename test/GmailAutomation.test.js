const test = require('node:test');
const assert = require('node:assert/strict');

const {
  applyMessageMutations_,
  backfillAtomeTransactions30Days_,
  previewAtomeBackfill30Days_,
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
  const previous = Object.fromEntries(['Gmail', 'LockService', 'LABELS', 'buildDecision_', 'isAtomeSender_', 'summarizeDecisions_', 'countLabels_', 'isArchiveDue_']
    .map(name => [name, global[name]]));
  const previousLog = console.log;
  Object.assign(global, {
    ...Object.fromEntries(['LABELS', 'buildDecision_', 'isAtomeSender_', 'summarizeDecisions_', 'countLabels_', 'isArchiveDue_']
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
