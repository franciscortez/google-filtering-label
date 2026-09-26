const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ARCHIVE_POLICY,
  LABELS,
  buildDecision_,
  classifyMessage_,
  countLabels_,
  extractEmailAddress_,
  getGitHubAutomationArchiveReason_,
  isArchiveDue_,
  isAutomatedGitHubMessage_,
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

test('labels Web3Forms submissions with arbitrary subjects and notification tags', () => {
  for (const from of [
    'Notifications <notify+f8vdtq@web3forms.com>',
    'Website <NOTIFY+another-form@WEB3FORMS.COM>',
    'notify@web3forms.com',
  ]) {
    assert.deepEqual(classify(from, 'test'), [LABELS.web3forms]);
    const decision = buildDecision_({
      from,
      subject: 'Project inquiry',
      gmailLabelIds: ['INBOX', 'UNREAD'],
      existingLabelNames: [LABELS.reading],
    });
    assert.equal(decision.archiveEligible, false);
    assert.equal(decision.archiveImmediately, false);
    assert.equal(decision.archiveReason, `protected:${LABELS.web3forms}`);
  }
});

test('excludes Web3Forms onboarding, unrelated senders, and lookalike domains', () => {
  for (const from of [
    'support@web3forms.com',
    'notify+tag@web3forms.com.example.com',
    'notify+tag@otherweb3forms.com',
    'Web3Forms <person@example.com>',
  ]) {
    assert.deepEqual(classify(from, 'New form submission'), []);
  }
  assert.deepEqual(
    classify('Google <noreply-accounts@google.com>', 'You shared some Google Account data with Web3Forms'),
    [LABELS.security]
  );
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

test('classifies observed trusted-bank subject families', () => {
  const cases = [
    ['MariBank <alerts@maribank.com.ph>', 'MariBank Transfer Notification', [LABELS.transactions]],
    ['MariBank <alerts@maribank.com.ph>', 'Incoming Transfer Notification', [LABELS.transactions]],
    ['MariCard <alerts@maribank.com.ph>', 'Debit Card Transaction Notification', [LABELS.transactions]],
    ['MariCard <alerts@maribank.com.ph>', 'ATM Withdrawal Notification', [LABELS.transactions]],
    ['MariBank <alerts@maribank.com.ph>', 'Shopee Payment Confirmation', [LABELS.transactions]],
    ['MariBank <alerts@maribank.com.ph>', 'BiIl Payment Notification', [LABELS.transactions]],
    ['UnionBank <noreply@unionbankph.com>', 'Fund Transfer Confirmation', [LABELS.transactions]],
    ['UnionBank <noreply@unionbankph.com>', 'Successful Interbank Funds Transfer', [LABELS.transactions]],
    ['UnionBank <noreply@unionbankph.com>', 'Your transfer has been submitted', [LABELS.transactions]],
    ['UnionBank <noreply@unionbankph.com>', 'Bills Payment Confirmation', [LABELS.transactions]],
    ['UnionBank <noreply@unionbankph.com>', 'Check Deposit Confirmation', [LABELS.transactions]],
    ['UnionBank <noreply@unionbankph.com>', 'Check Deposit Cleared', [LABELS.transactions]],
    ['UnionBank <noreply@unionbankph.com>', 'Fund Transfer Request Submitted (Ref# UB000000)', [LABELS.transactions]],
    ['BPI <onlinebanking@bpi.com.ph>', 'Incoming Interbank Transfer Confirmation', [LABELS.transactions]],
  ];

  cases.forEach(([from, subject, expected]) => {
    assert.deepEqual(classify(from, subject), expected, subject);
  });
});

test('adds Action to failed bank transactions', () => {
  const cases = [
    ['MariBank <alerts@maribank.com.ph>', 'Debit Card Transaction Declined'],
    ['UnionBank <noreply@unionbankph.com>', 'Fund Transfer Failed'],
    ['BPI <onlinebanking@bpi.com.ph>', 'Unauthorized Card Transaction'],
    ['UnionBank <noreply@unionbankph.com>', 'Bill Payment Reversed'],
  ];

  cases.forEach(([from, subject]) => {
    assert.deepEqual(classify(from, subject), [LABELS.action, LABELS.transactions], subject);
  });
});

test('keeps bank setup and service confirmations under Banking', () => {
  const cases = [
    ['MariBank <welcome@maribank.com.ph>', 'Your account is ready'],
    ['MariCard <cards@maribank.com.ph>', 'Activate your Debit Card'],
    ['MariCard <cards@maribank.com.ph>', 'Your Debit Card is on its way'],
    ['MariCard <cards@maribank.com.ph>', 'Your card has been activated'],
    ['UnionBank <noreply@unionbankph.com>', 'Link your Visa Debit Card'],
  ];

  cases.forEach(([from, subject]) => {
    assert.deepEqual(classify(from, subject), [LABELS.banking], subject);
  });
});

test('adds Banking and Security to bank security events', () => {
  const cases = [
    ['MariBank <alerts@maribank.com.ph>', 'Your One-Time Password (OTP)'],
    ['UnionBank <noreply@unionbankph.com>', 'New Login Detected'],
    ['BPI <onlinebanking@bpi.com.ph>', 'Your device was registered'],
    ['UnionBank <noreply@unionbankph.com>', 'Your profile has been blocked'],
    ['UnionBank <noreply@unionbankph.com>', 'Profile Successfully Unblocked'],
    ['UnionBank <noreply@unionbankph.com>', 'Mobile Number Update Confirmation'],
    ['BPI <alerts@bpi.com.ph>', 'Fraud Alert'],
    ['BPI <onlinebanking@bpi.com.ph>', 'Mobile Key Activation'],
  ];

  cases.forEach(([from, subject]) => {
    assert.deepEqual(classify(from, subject), [LABELS.banking, LABELS.security], subject);
  });
});

test('makes bank promotions and advisories archive eligible', () => {
  const promotion = buildDecision_({
    from: 'MariBank <offers@maribank.com.ph>',
    subject: 'Refer a friend and earn rewards',
  });
  const advisory = buildDecision_({
    from: 'UnionBank <noreply@unionbankph.com>',
    subject: 'Advisory: Scheduled System Maintenance',
  });

  assert.deepEqual(promotion.labelNames, [LABELS.social]);
  assert.deepEqual(advisory.labelNames, [LABELS.notices]);
  assert.equal(promotion.archiveEligible, true);
  assert.equal(advisory.archiveEligible, true);
});

test('uses trusted bank marketing senders without adding Banking', () => {
  assert.deepEqual(
    classify('UnionBank <sf.noreply@ub.unionbankph.com>', 'Pack Light, Bank Smart – Your Travel Sidekick Awaits!'),
    [LABELS.social]
  );
  assert.deepEqual(
    classify('UnionBank <sf.noreply@ub.unionbankph.com>', 'Important Update on Transaction Fees'),
    [LABELS.notices]
  );
  assert.deepEqual(
    classify('MariBank <marketing@maribank.com.ph>', 'Mari Loan: Get up to PHP 100,000 in seconds!'),
    [LABELS.social]
  );
});

test('does not mistake setup deposit copy for a transaction', () => {
  assert.deepEqual(
    classify('MariBank <alerts@maribank.com.ph>', 'Welcome to MariBank! Get started with a bonus on your first deposit!'),
    [LABELS.banking]
  );
});

test('covers every observed MariBank subject family', () => {
  const from = 'MariBank <alerts@maribank.com.ph>';
  const cases = [
    ['MariBank Transfer Notification', [LABELS.transactions]],
    ['Successful MariBank Transfer', [LABELS.transactions]],
    ['Successful Incoming Transfer', [LABELS.transactions]],
    ['Successful Debit Card Transaction', [LABELS.transactions]],
    ['Successful Card Transaction', [LABELS.transactions]],
    ['Successful BiIl Payment to a biller', [LABELS.transactions]],
    ['Successful Shopee Payment', [LABELS.transactions]],
    ['Successful ATM Withdrawal', [LABELS.transactions]],
    ['MariBank and ShopeePay Successfully Linked', [LABELS.banking]],
    ['Your Physical Card is Now Active and Ready for Use!', [LABELS.banking]],
    ['Your Physical Card has Arrived!', [LABELS.banking]],
    ['Successful Limit Update', [LABELS.banking]],
    ['Your Debit Card is Ready!', [LABELS.banking]],
    ['Welcome to MariBank! Get started with a bonus on your first deposit!', [LABELS.banking]],
  ];

  cases.forEach(([subject, expected]) => {
    assert.deepEqual(classify(from, subject), expected, subject);
  });
});

test('covers observed UnionBank operational subject families', () => {
  const from = 'UnionBank <online@unionbankph.com>';
  const cases = [
    ['Fund Transfer Successful (Ref# test)', [LABELS.transactions]],
    ['Fund Transfer Confirmation (Ref# test)', [LABELS.transactions]],
    ['Fund Transfer Request Submitted (Ref# test)', [LABELS.transactions]],
    ['Bills Payment Confirmation', [LABELS.transactions]],
    ['Check Deposit Cleared', [LABELS.transactions]],
    ['Check Deposit Accepted', [LABELS.transactions]],
    ['Password Reset Successful', [LABELS.banking, LABELS.security]],
    ['Reset Password Request', [LABELS.banking, LABELS.security]],
    ['Password Change Confirmation', [LABELS.banking, LABELS.security]],
    ['Profile Succesfully Unblocked', [LABELS.banking, LABELS.security]],
    ['Unblock Profile Request', [LABELS.banking, LABELS.security]],
    ['Your UnionBank Online profile was blocked due to unsuccessful login attempts', [LABELS.banking, LABELS.security]],
    ['New Device UnionBank Online Sign In', [LABELS.banking, LABELS.security]],
    ['New Device Added to UnionBank Online Profile', [LABELS.banking, LABELS.security]],
    ['Trust Device Request', [LABELS.banking, LABELS.security]],
    ['Mobile Number Update Confirmation', [LABELS.banking, LABELS.security]],
    ['You are all set with Apple Pay', [LABELS.banking]],
    ['Enable Biometrics Confirmation', [LABELS.banking]],
  ];

  cases.forEach(([subject, expected]) => {
    assert.deepEqual(classify(from, subject), expected, subject);
  });
});

test('covers every observed BPI subject family', () => {
  const from = 'BPI <onlinebanking@bpi.com.ph>';
  const cases = [
    ['Incoming Interbank Funds Transfer Confirmation', [LABELS.transactions]],
    ['Mobile Key Activation', [LABELS.banking, LABELS.security]],
    ['Device Registration Confirmation', [LABELS.banking, LABELS.security]],
    ['Notice on your BPI Account Application', [LABELS.banking]],
    ['We received your BPI #SaveUp Online Application', [LABELS.banking]],
    ['[BPI] Online Deposit Account Application', [LABELS.banking]],
    ['Win 1-Year Premium Plan! Save & Stream Promo', [LABELS.social]],
  ];

  cases.forEach(([subject, expected]) => {
    assert.deepEqual(classify(from, subject), expected, subject);
  });
});

test('does not trust bank-like subjects from unrelated senders', () => {
  const subjects = [
    'Fund Transfer Confirmation',
    'Debit Card Transaction Declined',
    'Your One-Time Password (OTP)',
    'Advisory: Scheduled System Maintenance',
    'Refer a friend and earn rewards',
  ];

  subjects.forEach(subject => {
    assert.deepEqual(classify('Unknown <sender@example.com>', subject), [], subject);
  });
});

test('classifies trusted Atome transaction events and protects them from archiving', () => {
  const from = 'Atome <no-reply@service.atome.ph>';
  const cases = [
    ['Transaction Confirmation: Example Store', 'Your payment of PHP 100.00 using your Atome Card has been successfully processed.'],
    ['Purchase Confirmation: Example Store', 'Your purchase is complete.'],
    ['Your Atome Card update', 'Your card payment of PHP 100.00 has been successfully processed.'],
    ['Card Transaction Notification', 'Your purchase was completed.'],
  ];

  cases.forEach(([subject, snippet]) => {
    const decision = buildDecision_({ from, subject, snippet, gmailLabelIds: ['INBOX'] });
    assert.deepEqual(decision.labelNames, [LABELS.transactions], subject);
    assert.equal(decision.archiveEligible, false, subject);
    assert.equal(decision.archiveReason, `protected:${LABELS.transactions}`, subject);
  });
});

test('Atome failure events require Action as well as Transactions', () => {
  const from = 'Atome <alerts@service.atome.ph>';
  const cases = [
    ['Card Transaction Declined', ''],
    ['Payment Failed', ''],
    ['Transaction Reversed', ''],
    ['Unauthorized Card Transaction', ''],
    ['Your Atome Card update', 'Your card transaction was cancelled.'],
  ];

  cases.forEach(([subject, snippet]) => {
    assert.deepEqual(classify(from, subject, snippet), [LABELS.action, LABELS.transactions], subject);
  });
});

test('Atome non-transactions and untrusted senders do not get Transactions', () => {
  const from = 'Atome <no-reply@service.atome.ph>';
  const cases = [
    ['Atome Email Verification Code', "Here's your verification code. Enter it in the Atome App."],
    ['Welcome to Atome', 'Set up your account and activate your card.'],
    ['Your Atome payment is due soon', 'Pay before the due date to avoid fees.'],
    ['Atome Card rewards', 'Get cashback on your next purchase.'],
    ['Your account update', 'Learn more about payment options and fees.'],
  ];

  cases.forEach(([subject, snippet]) => {
    assert.equal(classify(from, subject, snippet).includes(LABELS.transactions), false, subject);
  });
  for (const sender of ['no-reply@atome.ph.example.com', 'no-reply@otheratome.ph', 'Atome <person@example.com>']) {
    assert.equal(classify(sender, 'Transaction Confirmation: Example Store').includes(LABELS.transactions), false, sender);
  }
  assert.equal(classify('person@example.com', 'Your Atome transaction was successful').includes(LABELS.transactions), false);
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

test('archives only after exact 12-hour delay', () => {
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

test('archives with custom delay parameter', () => {
  const now = Date.UTC(2026, 8, 3, 12);
  const sixHoursMs = 6 * 60 * 60 * 1000;
  const routine = buildDecision_({
    id: '1',
    from: 'GitHub <notifications@github.com>',
    subject: 'Re: [owner/repo] routine update',
    internalDate: String(now - sixHoursMs),
  });

  assert.equal(isArchiveDue_(routine, now), false);
  assert.equal(isArchiveDue_(routine, now, sixHoursMs), true);
  assert.equal(isArchiveDue_(routine, now, sixHoursMs + 1), false);
  assert.equal(isArchiveDue_(routine, now, 0), true);
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

test('every GitHub bot archives immediately', () => {
  const now = Date.UTC(2026, 8, 3, 12);
  ['linear-code[bot]', 'vercel[bot]', 'future-service[bot]'].forEach(botName => {
    const bot = buildDecision_({
      id: botName,
      from: `"${botName}" <notifications@github.com>`,
      subject: 'Re: [owner/repo] automated update (PR #69)',
      snippet: `${botName} left a comment`,
      internalDate: String(now),
      gmailLabelIds: ['INBOX', 'STARRED', 'UNREAD'],
    });

    assert.equal(isAutomatedGitHubMessage_(bot), true, botName);
    assert.equal(getGitHubAutomationArchiveReason_(bot), 'immediate:github-bot', botName);
    assert.equal(bot.archiveEligible, true, botName);
    assert.equal(bot.archiveImmediately, true, botName);
    assert.equal(bot.archiveReason, 'immediate:github-bot', botName);
    assert.equal(isArchiveDue_(bot, now), true, botName);
    assert.deepEqual(bot.labelNames, [LABELS.github], botName);
  });
});

test('GitHub CI activity archives immediately despite action and starred protection', () => {
  const ciFailure = buildDecision_({
    from: 'Developer <notifications@github.com>',
    cc: 'Ci activity <ci_activity@noreply.github.com>',
    subject: '[owner/repo] PR run failed: CI - feature work (abc1234)',
    gmailLabelIds: ['INBOX', 'STARRED', 'UNREAD'],
  });

  assert.equal(isAutomatedGitHubMessage_(ciFailure), true);
  assert.equal(getGitHubAutomationArchiveReason_(ciFailure), 'immediate:github-ci');
  assert.deepEqual(ciFailure.labelNames, [LABELS.action, LABELS.github]);
  assert.equal(ciFailure.archiveEligible, true);
  assert.equal(ciFailure.archiveImmediately, true);
  assert.equal(ciFailure.archiveReason, 'immediate:github-ci');
});

test('human GitHub activity and non-GitHub bot text do not archive immediately', () => {
  const humanReview = buildDecision_({
    from: 'Reviewer <notifications@github.com>',
    cc: 'Review requested <review_requested@noreply.github.com>',
    subject: 'Re: [owner/repo] feature work (PR #42)',
    snippet: 'Reviewer requested your review',
  });
  const outsideBot = buildDecision_({
    from: '"service[bot]" <notifications@example.com>',
    subject: 'Automated update',
  });

  assert.equal(isAutomatedGitHubMessage_(humanReview), false);
  assert.equal(humanReview.archiveImmediately, false);
  assert.equal(humanReview.archiveEligible, false);
  assert.equal(isAutomatedGitHubMessage_(outsideBot), false);
  assert.equal(outsideBot.archiveImmediately, false);
});
