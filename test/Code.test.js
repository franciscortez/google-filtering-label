const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ARCHIVE_POLICY,
  LABELS,
  buildDecision_,
  classifyMessage_,
  countLabels_,
  extractEmailAddress_,
  isArchiveDue_,
  isLinearCodeBotMessage_,
  summarizeDecisions_,
} = require('../helpers/Classifier.js');

function classify(from, subject, snippet = '') {
  return classifyMessage_({ from, subject, snippet });
}

test('extracts address from display-name header', () => {
  assert.equal(
    extractEmailAddress_('Francis Emil Cortez <notifications@github.com>'),
    'notifications@github.com'
  );
});

test('labels GitHub notifications and adds Action only for failures', () => {
  assert.deepEqual(
    classify('CI <notifications@github.com>', '[owner/repo] PR run failed: CI'),
    [LABELS.action, LABELS.github]
  );
  assert.deepEqual(
    classify('Bot <notifications@github.com>', 'Re: [owner/repo] PR #35 merged'),
    [LABELS.github]
  );
  assert.deepEqual(
    classify('GitHub <noreply@github.com>', 'owner invited you to owner/repo'),
    [LABELS.action, LABELS.github]
  );
  assert.deepEqual(
    classify(
      'GitHub <notifications@github.com>',
      'Re: [owner/repo] feature work (PR #42)',
      '@franciscortez changes requested before merge'
    ),
    [LABELS.action, LABELS.github]
  );
});

test('labels Gemini meeting notes', () => {
  assert.deepEqual(
    classify('Gemini <gemini-notes@google.com>', 'Notes: Meeting on 24 Aug 2026'),
    [LABELS.meetings]
  );
  assert.deepEqual(classify('Other <other@google.com>', 'Notes: Meeting on 24 Aug 2026'), []);
});

test('labels Wise income as Income and Transactions', () => {
  assert.deepEqual(
    classify('Wise <noreply@wise.com>', 'Money received from Client Ltd'),
    [LABELS.income, LABELS.transactions]
  );
});

test('allows only marked self-sent synthetic Income tests', () => {
  assert.deepEqual(
    classify('Francis <francisemil.cortez@gmail.com>', '[TEST-INCOME] Money received from Test Client'),
    [LABELS.income, LABELS.transactions]
  );
  assert.deepEqual(
    classify('Francis <francisemil.cortez@gmail.com>', 'Money received from Test Client'),
    []
  );
  assert.deepEqual(
    classify('Other <other@gmail.com>', '[TEST-INCOME] Money received from Test Client'),
    []
  );
});

test('separates bank transactions from general banking mail', () => {
  assert.deepEqual(
    classify('MariBank <alerts@maribank.com.ph>', 'MariBank Transfer Notification'),
    [LABELS.transactions]
  );
  assert.deepEqual(
    classify('BPI <news@communications.bpi.com.ph>', 'Your monthly account update'),
    [LABELS.banking]
  );
});

test('separates career applications from job alerts', () => {
  assert.deepEqual(
    classify('Jobstreet <updates@e.jobstreet.com>', 'Your application was successfully submitted'),
    [LABELS.applications]
  );
  assert.deepEqual(
    classify('Indeed <alert@jobalert.indeed.com>', 'New software developer jobs'),
    [LABELS.jobAlerts]
  );
  assert.deepEqual(
    classify('Jobstreet <noreply@e.jobstreet.com>', 'The API Developer job with Acme has closed'),
    [LABELS.applications]
  );
  assert.deepEqual(
    classify('LinkedIn <jobalerts-noreply@linkedin.com>', 'Continue receiving job alerts'),
    [LABELS.jobAlerts]
  );
  assert.deepEqual(
    classify('RemoteStaff <recruiters@remotestaff.com>', 'We would like to match you with job openings'),
    [LABELS.jobAlerts]
  );
});

test('requires job subjects for broad career senders', () => {
  assert.deepEqual(
    classify('Virtual Staff <noreply@virtualstaff.ph>', 'Take the Next Step – Start Applying Today'),
    [LABELS.jobAlerts]
  );
  assert.deepEqual(
    classify('Virtual Staff <noreply@virtualstaff.ph>', 'Activate your Virtual Staff account'),
    [LABELS.action]
  );
  assert.deepEqual(
    classify('Sofia <messages@notifications.freelancer.com>', 'Re: Sofia'),
    []
  );
});

test('labels trusted invitations and setup actions', () => {
  assert.deepEqual(
    classify('Notion <notify@updates.notion.so>', 'Join your team on Notion'),
    [LABELS.action]
  );
  assert.deepEqual(
    classify('Google <no-reply@google.com>', 'Francis, finish setting up your Apple iPhone with Google'),
    [LABELS.action]
  );
});

test('labels subscriptions and their financial events', () => {
  assert.deepEqual(
    classify('Spotify <no-reply@spotify.com>', 'Rhea joined your Spotify plan'),
    [LABELS.subscriptions]
  );
  assert.deepEqual(
    classify('Spotify <no-reply@spotify.com>', 'Your order confirmation for Premium Family'),
    [LABELS.subscriptions, LABELS.transactions]
  );
});

test('uses Security and Learning labels for clear matches', () => {
  assert.deepEqual(
    classify('Google <no-reply@accounts.google.com>', 'Security alert'),
    [LABELS.security]
  );
  assert.deepEqual(
    classify('Anthropic Education <academy-support@anthropic.com>', 'Completion of Claude Code 101'),
    [LABELS.learning]
  );
  assert.deepEqual(
    classify('LinkedIn <security-noreply@linkedin.com>', 'Francis, your profile photo was changed'),
    [LABELS.security]
  );
  assert.deepEqual(
    classify('LinkedIn <news@linkedin.com>', 'Francis, your profile photo was changed'),
    []
  );
  assert.deepEqual(
    classify('Google <noreply-accounts@google.com>', 'You shared some Google Account data with Spotify'),
    [LABELS.security]
  );
  assert.deepEqual(
    classify('Google <no-reply@google.com>', 'Francis, review your Google Account settings'),
    []
  );
});

test('labels known reading and social senders', () => {
  assert.deepEqual(classify('Firecrawl <news@firecrawl.dev>', 'Firecrawl Updates'), [LABELS.reading]);
  assert.deepEqual(classify('Nike <nike@official.nike.com>', 'New styles on sale'), [LABELS.social]);
});

test('labels trusted product and policy notices', () => {
  assert.deepEqual(
    classify('Loom <noreply@po.atlassian.net>', 'Improvements are coming to Loom permissions'),
    [LABELS.notices]
  );
  assert.deepEqual(
    classify('PayMongo <support@paymongo.com>', 'Feature Advisory: Support Ticket Tracking'),
    [LABELS.notices]
  );
  assert.deepEqual(
    classify('Unknown <sender@example.com>', 'We updated our Privacy Policy'),
    []
  );
});

test('counts each assigned label once per message', () => {
  const decisions = [
    buildDecision_({ id: '1', from: 'GitHub <noreply@github.com>', subject: 'Owner invited you to owner/repo' }),
    buildDecision_({ id: '2', from: 'Spotify <no-reply@spotify.com>', subject: 'Order confirmation for Premium Family' }),
  ];
  assert.deepEqual(countLabels_(decisions), {
    [LABELS.action]: 1,
    [LABELS.github]: 1,
    [LABELS.subscriptions]: 1,
    [LABELS.transactions]: 1,
  });
});

test('leaves uncertain messages untouched', () => {
  assert.deepEqual(classify('Person <person@example.com>', 'Quick question'), []);
});

test('marks only low-priority categories as archive eligible', () => {
  const action = buildDecision_({ id: '1', from: 'CI <notifications@github.com>', subject: 'Workflow failed' });
  const security = buildDecision_({ id: '2', from: 'Google <no-reply@accounts.google.com>', subject: 'Security alert' });
  const routine = buildDecision_({ id: '3', from: 'Nike <nike@official.nike.com>', subject: 'New styles' });
  const uncertain = buildDecision_({ id: '4', from: 'a@example.com', subject: 'Hello' });

  assert.equal(action.archive, false);
  assert.equal(security.archive, false);
  assert.equal(routine.archive, false);
  assert.equal(uncertain.archive, false);
  assert.equal(action.archiveEligible, false);
  assert.equal(security.archiveEligible, false);
  assert.equal(routine.archiveEligible, true);
  assert.equal(uncertain.archiveEligible, false);
  assert.deepEqual(summarizeDecisions_([action, security, routine, uncertain]), {
    scanned: 4,
    matched: 3,
    archived: 0,
    unmatched: 1,
    archiveEligible: 1,
  });
});

test('protected labels override archiveable labels', () => {
  const githubAction = buildDecision_({
    id: '1',
    from: 'GitHub <notifications@github.com>',
    subject: '[owner/repo] PR run failed: CI',
  });
  const subscriptionPayment = buildDecision_({
    id: '2',
    from: 'Spotify <no-reply@spotify.com>',
    subject: 'Order confirmation for Premium Family',
  });

  assert.equal(githubAction.archiveEligible, false);
  assert.equal(githubAction.archiveReason, `protected:${LABELS.action}`);
  assert.equal(subscriptionPayment.archiveEligible, false);
  assert.equal(subscriptionPayment.archiveReason, `protected:${LABELS.transactions}`);

  const manuallyProtected = buildDecision_({
    id: '3',
    from: 'GitHub <notifications@github.com>',
    subject: 'Re: [owner/repo] routine update',
    existingLabelNames: [LABELS.action],
  });
  assert.equal(manuallyProtected.archiveEligible, false);
  assert.equal(manuallyProtected.archiveReason, `protected:${LABELS.action}`);
});

test('starred protects mail while Gmail Important does not', () => {
  const starred = buildDecision_({
    id: '1',
    from: 'GitHub <notifications@github.com>',
    subject: 'Re: [owner/repo] routine update',
    gmailLabelIds: ['INBOX', 'STARRED'],
  });
  const important = buildDecision_({
    id: '2',
    from: 'GitHub <notifications@github.com>',
    subject: 'Re: [owner/repo] routine update',
    gmailLabelIds: ['INBOX', 'IMPORTANT', 'UNREAD'],
  });

  assert.equal(starred.archiveEligible, false);
  assert.equal(starred.archiveReason, 'starred');
  assert.equal(important.archiveEligible, true);
});

test('archives only after exact 24-hour delay', () => {
  const now = Date.UTC(2026, 8, 3, 12);
  const routine = buildDecision_({
    id: '1',
    from: 'GitHub <notifications@github.com>',
    subject: 'Re: [owner/repo] routine update',
    internalDate: String(now - ARCHIVE_POLICY.delayMs),
  });

  assert.equal(isArchiveDue_(routine, now), true);
  assert.equal(isArchiveDue_({ ...routine, internalDate: String(now - ARCHIVE_POLICY.delayMs + 1) }, now), false);
  assert.equal(isArchiveDue_({ ...routine, internalDate: String(now + 1000) }, now), false);
  assert.equal(isArchiveDue_({ ...routine, internalDate: 'invalid' }, now), false);
});

test('balanced archive set covers routine categories', () => {
  const cases = [
    ['GitHub <notifications@github.com>', 'Re: [owner/repo] routine update'],
    ['Indeed <alert@jobalert.indeed.com>', 'New software developer jobs'],
    ['Anthropic <academy-support@anthropic.com>', 'Completion of Claude Code 101'],
    ['Firecrawl <news@firecrawl.dev>', 'Firecrawl Updates'],
    ['PayMongo <support@paymongo.com>', 'Feature Advisory: Dashboard updates'],
    ['Nike <nike@official.nike.com>', 'New styles'],
    ['Spotify <no-reply@spotify.com>', 'Welcome to Premium Family'],
  ];

  cases.forEach(([from, subject]) => {
    assert.equal(buildDecision_({ from, subject }).archiveEligible, true, subject);
  });
});

test('Linear Code bot always archives immediately', () => {
  const now = Date.UTC(2026, 8, 3, 12);
  const linearBot = buildDecision_({
    id: 'linear',
    from: '"linear-code[bot]" <notifications@github.com>',
    subject: 'Re: [owner/repo] test update (PR #69)',
    snippet: 'linear-code[bot] left a comment',
    internalDate: String(now),
    gmailLabelIds: ['INBOX', 'STARRED', 'UNREAD'],
  });

  assert.equal(isLinearCodeBotMessage_(linearBot), true);
  assert.equal(linearBot.archiveEligible, true);
  assert.equal(linearBot.archiveImmediately, true);
  assert.equal(linearBot.archiveReason, 'immediate:linear-code-bot');
  assert.equal(isArchiveDue_(linearBot, now), true);
  assert.deepEqual(linearBot.labelNames, [LABELS.github]);
});

test('other GitHub bots retain normal delayed policy', () => {
  const otherBot = buildDecision_({
    from: '"vercel[bot]" <notifications@github.com>',
    subject: 'Re: [owner/repo] deployment update',
  });
  assert.equal(isLinearCodeBotMessage_(otherBot), false);
  assert.equal(otherBot.archiveEligible, true);
  assert.equal(otherBot.archiveImmediately, false);
});
