const LABELS = Object.freeze({
  action: '01 Action',
  github: '02 Work/GitHub',
  meetings: '02 Work/Meetings',
  income: '03 Money/Income',
  transactions: '03 Money/Transactions',
  banking: '03 Money/Banking',
  subscriptions: '03 Money/Subscriptions',
  security: '04 Security',
  applications: '05 Career/Applications',
  jobAlerts: '05 Career/Job Alerts',
  learning: '06 Learning',
  reading: '07 Reading',
  notices: '07 Reading/Notices',
  social: '08 Social',
});

const CLASSIFIER_RULES = Object.freeze({
  bankDomains: Object.freeze(['bpi.com.ph', 'unionbankph.com', 'maribank.com.ph']),
  applicationDomains: Object.freeze(['e.jobstreet.com', 'myworkday.com']),
  alwaysJobAlertDomains: Object.freeze([
    'noreply.jobs2web.com',
    'jobalert.indeed.com',
    'email.jobstreet.com',
  ]),
  readingDomains: Object.freeze([
    'e.atlassian.com',
    'firecrawl.dev',
    'tonyrobbins.com',
    'lucidchart.com',
    'neon.tech',
  ]),
  noticeDomains: Object.freeze([
    'atlassian.net',
    'paymongo.com',
    'lovable.dev',
    'communication.microsoft.com',
  ]),
  securityDomains: Object.freeze([
    'accounts.google.com',
    'google.com',
    'email.openai.com',
    'microsoft.com',
    'github.com',
    'bpi.com.ph',
    'unionbankph.com',
    'maribank.com.ph',
  ]),
});

const ARCHIVE_POLICY = Object.freeze({
  delayMs: 24 * 60 * 60 * 1000,
  protectedLabels: Object.freeze([
    LABELS.action,
    LABELS.meetings,
    LABELS.income,
    LABELS.transactions,
    LABELS.banking,
    LABELS.security,
    LABELS.applications,
  ]),
  archiveLabels: Object.freeze([
    LABELS.github,
    LABELS.jobAlerts,
    LABELS.learning,
    LABELS.reading,
    LABELS.notices,
    LABELS.social,
    LABELS.subscriptions,
  ]),
});

function buildDecision_(message) {
  const labelNames = classifyMessage_(message);
  const policyLabelNames = Array.from(new Set([
    ...labelNames,
    ...(message.existingLabelNames || []),
  ])).sort();
  const archivePolicy = evaluateArchivePolicy_({ ...message, labelNames: policyLabelNames });
  return { ...message, labelNames, policyLabelNames, ...archivePolicy, archive: false };
}

/** Pure sender/subject classifier. Every matching rule runs. */
function classifyMessage_(message) {
  const sender = extractEmailAddress_(message.from);
  const domain = sender.includes('@') ? sender.split('@').pop() : '';
  const subject = normalizeText_(message.subject);
  const snippet = normalizeText_(message.snippet);
  const labels = new Set();

  classifyWork_(labels, sender, domain, subject);
  classifyAction_(labels, sender, domain, subject, snippet);
  classifyMoney_(labels, sender, domain, subject);
  classifyCareer_(labels, sender, domain, subject);
  classifyKnowledge_(labels, sender, domain, subject);
  classifySecurity_(labels, sender, domain, subject);

  return Array.from(labels).sort();
}

function classifyWork_(labels, sender, domain, subject) {
  if (domain === 'github.com') labels.add(LABELS.github);
  if (sender === 'gemini-notes@google.com' && /^notes: meeting\b/i.test(subject)) {
    labels.add(LABELS.meetings);
  }
}

function classifyAction_(labels, sender, domain, subject, snippet) {
  const explicitAction = /\b(action required|action needed|required action|final reminder|complete your signup|confirm your email)\b/i;
  const failedGitHubRun = /\b(run failed|workflow failed|jobs? (?:has |have )?failed|checks? failed)\b/i;
  const githubInvitation = /\binvited you to\b/i;
  const githubAction = /\b(review requested|requested your review|assigned you|mentioned you|blocking|not ready to merge|changes requested)\b|@franciscortez\b/i;
  const githubText = `${subject} ${snippet}`;

  if (explicitAction.test(subject)) labels.add(LABELS.action);
  if (domain === 'github.com'
      && (failedGitHubRun.test(githubText)
        || githubInvitation.test(githubText)
        || githubAction.test(githubText))) {
    labels.add(LABELS.action);
  }
  if (sender === 'noreply@virtualstaff.ph' && /\bactivate your .*account\b/i.test(subject)) {
    labels.add(LABELS.action);
  }
  if (sender === 'notify@updates.notion.so' && /\bjoin your team\b/i.test(subject)) {
    labels.add(LABELS.action);
  }
  if (sender === 'no-reply@google.com' && /\bfinish setting up\b/i.test(subject)) {
    labels.add(LABELS.action);
  }
}

function classifyMoney_(labels, sender, domain, subject) {
  const isWise = domain === 'wise.com';
  const isMariBank = domain === 'maribank.com.ph';
  const isSyntheticIncomeTest = sender === 'francisemil.cortez@gmail.com'
    && /^\[test-income\]\s+money received\b/i.test(subject);
  const transactionSubject = /\b(money received|transfer sent|transfer notification|funds transfer|interbank funds transfer)\b/i;

  if ((isWise && /^money received\b/i.test(subject)) || isSyntheticIncomeTest) {
    labels.add(LABELS.income);
    labels.add(LABELS.transactions);
  } else if ((isWise || isMariBank) && transactionSubject.test(subject)) {
    labels.add(LABELS.transactions);
  }

  const isBankSender = domainMatches_(domain, CLASSIFIER_RULES.bankDomains);
  if (isBankSender && !labels.has(LABELS.transactions)) labels.add(LABELS.banking);

  const isSpotify = domainMatches_(domain, ['spotify.com', 'hello.spotify.com']);
  const subscriptionSubject = /\b(premium|family plan|spotify plan|subscription|membership|renewal)\b/i;
  const subscriptionPaymentSubject = /\b(order confirmation|payment|paid|receipt|charged|invoice|purchase)\b/i;
  if (isSpotify && subscriptionSubject.test(subject)) {
    labels.add(LABELS.subscriptions);
    if (subscriptionPaymentSubject.test(subject)) labels.add(LABELS.transactions);
  }
}

function classifyCareer_(labels, sender, domain, subject) {
  const applicationDomain = domainMatches_(domain, CLASSIFIER_RULES.applicationDomains);
  const applicationSubject = /\b(application|applied for|jobs? you applied for|profile is being discovered|candidate|interview|job .+ has closed)\b/i.test(subject);
  if (applicationDomain && applicationSubject) labels.add(LABELS.applications);

  const alwaysJobAlert = domainMatches_(domain, CLASSIFIER_RULES.alwaysJobAlertDomains)
    || sender === 'jobalerts-noreply@linkedin.com';
  const conditionalJobAlertSender = sender === 'noreply@virtualstaff.ph'
    || sender === 'recruiters@remotestaff.com'
    || domainMatches_(domain, ['notifications.freelancer.com', 'updates.freelancer.com', 'freelancer.com']);
  const jobAlertSubject = /\b(jobs?|job alerts?|openings?|apply|applying|hired|employers?|earning|projects? available)\b/i;
  if (!labels.has(LABELS.applications)
      && (alwaysJobAlert || (conditionalJobAlertSender && jobAlertSubject.test(subject)))) {
    labels.add(LABELS.jobAlerts);
  }
}

function classifyKnowledge_(labels, sender, domain, subject) {
  if (sender === 'academy-support@anthropic.com' && /\b(course|registration|completion|academy|claude(?: code| platform)? 101)\b/i.test(subject)) {
    labels.add(LABELS.learning);
  }
  if (domainMatches_(domain, CLASSIFIER_RULES.readingDomains)) {
    labels.add(LABELS.reading);
  }
  const noticeSubject = /\b(advisory|feature notice|improvements? (?:are )?coming|terms(?: of use)?|privacy policy|policy update|updated our .+policy)\b/i;
  if (domainMatches_(domain, CLASSIFIER_RULES.noticeDomains) && noticeSubject.test(subject)) {
    labels.add(LABELS.notices);
  }
  if (domain === 'official.nike.com') labels.add(LABELS.social);
}

function classifySecurity_(labels, sender, domain, subject) {
  const securitySubject = /\b(security alert|security update|new sign-in|password|device registration|shared some .*account data|two-step|2-step|unauthori[sz]ed access|email (?:was )?changed|account (?:was )?changed)\b/i;
  const linkedInAccountChange = sender === 'security-noreply@linkedin.com'
    && /\b(profile photo|email|password|phone|account).*(?:was )?changed\b/i.test(subject);
  if ((securitySubject.test(subject) && domainMatches_(domain, CLASSIFIER_RULES.securityDomains))
      || linkedInAccountChange) {
    labels.add(LABELS.security);
  }
}

function evaluateArchivePolicy_(decision) {
  const githubAutomationReason = getGitHubAutomationArchiveReason_(decision);
  if (githubAutomationReason) {
    return {
      archiveEligible: true,
      archiveImmediately: true,
      archiveReason: githubAutomationReason,
    };
  }

  const gmailLabelIds = decision.gmailLabelIds || [];
  if (gmailLabelIds.includes('STARRED')) {
    return { archiveEligible: false, archiveImmediately: false, archiveReason: 'starred' };
  }

  const protectedLabel = ARCHIVE_POLICY.protectedLabels
    .find(labelName => decision.labelNames.includes(labelName));
  if (protectedLabel) {
    return { archiveEligible: false, archiveImmediately: false, archiveReason: `protected:${protectedLabel}` };
  }

  const archiveLabel = ARCHIVE_POLICY.archiveLabels
    .find(labelName => decision.labelNames.includes(labelName));
  if (archiveLabel) {
    return { archiveEligible: true, archiveImmediately: false, archiveReason: `routine:${archiveLabel}` };
  }

  return {
    archiveEligible: false,
    archiveImmediately: false,
    archiveReason: decision.labelNames.length ? 'not-archiveable' : 'unmatched',
  };
}

function isArchiveDue_(decision, nowMs, delayMs = ARCHIVE_POLICY.delayMs) {
  if (decision.archiveImmediately) return true;
  const internalDateMs = Number(decision.internalDate);
  return decision.archiveEligible
    && Number.isFinite(internalDateMs)
    && internalDateMs <= nowMs - delayMs;
}

function getGitHubAutomationArchiveReason_(message) {
  const from = normalizeText_(message.from);
  if (extractEmailAddress_(from) !== 'notifications@github.com') return '';
  if (/\[bot\]/i.test(from)) return 'immediate:github-bot';

  const cc = normalizeText_(message.cc);
  if (/(?:^|[<,\s])ci_activity@noreply\.github\.com(?:[>,\s]|$)/i.test(cc)) {
    return 'immediate:github-ci';
  }
  return '';
}

function isAutomatedGitHubMessage_(message) {
  return Boolean(getGitHubAutomationArchiveReason_(message));
}

function summarizeDecisions_(decisions) {
  const matched = decisions.filter(decision => decision.labelNames.length > 0);
  return {
    scanned: decisions.length,
    matched: matched.length,
    archived: 0,
    unmatched: decisions.length - matched.length,
    archiveEligible: decisions.filter(decision => decision.archiveEligible).length,
  };
}

function countLabels_(decisions) {
  return decisions.reduce((counts, decision) => {
    decision.labelNames.forEach(labelName => {
      counts[labelName] = (counts[labelName] || 0) + 1;
    });
    return counts;
  }, {});
}

function extractEmailAddress_(value) {
  const normalized = normalizeText_(value).toLowerCase();
  const angleMatch = normalized.match(/<([^<>\s]+@[^<>\s]+)>/);
  if (angleMatch) return angleMatch[1];
  const emailMatch = normalized.match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+/i);
  return emailMatch ? emailMatch[0] : normalized;
}

function normalizeText_(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function domainMatches_(domain, allowedDomains) {
  return allowedDomains.some(allowed => domain === allowed || domain.endsWith(`.${allowed}`));
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ARCHIVE_POLICY,
    LABELS,
    buildDecision_,
    classifyMessage_,
    countLabels_,
    evaluateArchivePolicy_,
    extractEmailAddress_,
    getGitHubAutomationArchiveReason_,
    isArchiveDue_,
    isAutomatedGitHubMessage_,
    summarizeDecisions_,
  };
}
