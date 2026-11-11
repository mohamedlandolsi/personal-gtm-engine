// Fix 4: a tool counts only when its script, embed or form endpoint is on the page (real usage).
// Words such as "HubSpot" in text, logos or integration lists do not count.
// Keep this list identical in Score Enriched and Draft Outreach.
const TECH = [
  ['hubspot',          /js\.hs-scripts\.com|js\.hsforms\.net|js\.hs-analytics\.net|js\.hs-banner\.com|js\.usemessages\.com/i],
  ['salesforce',       /pi\.pardot\.com|go\.pardot\.com|webto(?:lead|case)\.salesforce\.com/i],
  ['pipedrive',        /leadbooster-chat\.pipedrive\.com|webforms\.pipedrive\.com/i],
  ['intercom',         /widget\.intercom\.io|js\.intercomcdn\.com/i],
  ['segment',          /cdn\.segment\.com\/analytics/i],
  ['stripe',           /js\.stripe\.com/i],
  ['zapier',           /hooks\.zapier\.com/i],
  ['make',             /hook\.(?:eu|us)\d\.make\.com/i],
  ['apollo',           /assets\.apollo\.io\/micro\/website-tracker/i],
  ['mailchimp',        /chimpstatic\.com|list-manage\.com\/subscribe/i],
  ['brevo',            /sibforms\.com/i],
  ['calendly',         /assets\.calendly\.com|calendly\.com\/[a-z0-9_-]+(?:\/[a-z0-9_-]+)?["'?]/i],
  ['clearbit',         /tag\.clearbitscripts\.com/i],
  ['mixpanel',         /cdn\.mxpnl\.com/i],
  ['amplitude',        /cdn\.amplitude\.com/i],
  ['hotjar',           /static\.hotjar\.com/i],
  ['google_analytics', /googletagmanager\.com|gtag\(/i],
  ['linkedin_insight', /snap\.licdn\.com/i],
  ['webflow',          /website-files\.com|webflow\.js/i],
  ['framer',           /framerusercontent\.com/i],
  ['wordpress',        /\/wp-content\//i],
  ['shopify',          /cdn\.shopify\.com/i]
];
