const test = require('node:test');
const assert = require('node:assert/strict');

const { applyMessageMutations_ } = require('../helpers/GmailAutomation.js');

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
