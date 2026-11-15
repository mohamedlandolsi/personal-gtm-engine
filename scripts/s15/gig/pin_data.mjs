// Sprint 15: pin data for test_workflow on GTM Gig Finder (prints JSON). Posts are synthetic, timestamps relative to now.
import { S15 } from '../phase2_config.mjs';
const hoursAgo = (h) => new Date(Date.now() - h * 3600e3).toISOString();
const config = Object.assign({ rev: 'pin-test', enabled: true, outreach: { sender_name: 'Mohamed', llm: { chain: ['groq', 'groq:openai/gpt-oss-20b', 'template'], groq_model: 'openai/gpt-oss-120b', politeness_ms: 2000, max_wait_s: 20 } } }, S15);
config.outreach = Object.assign({ sender_name: 'Mohamed', llm: { chain: ['groq', 'groq:openai/gpt-oss-20b', 'template'], groq_model: 'openai/gpt-oss-120b', politeness_ms: 2000, max_wait_s: 20 } }, S15.outreach);
const posts = [
  { post_key: 'n8n:900001', platform: 'n8n_forum', url: 'https://community.n8n.io/t/looking-for-n8n-developer-hubspot-sheets/900001',
    title: 'Looking for n8n developer to sync HubSpot deals into Google Sheets',
    body_text: 'Hi all, we need someone to build an n8n workflow that pulls HubSpot deals every hour and writes them to Google Sheets, with a webhook for new deals. Paid task, remote is fine, EU hours preferred. DM me if interested.',
    poster: 'jane_doe', poster_company: '', posted_at: hoursAgo(5), reply_count: null, __source: 'manual' },
  { post_key: 'n8n:900002', platform: 'n8n_forum', url: 'https://community.n8n.io/t/for-hire-n8n-expert/900002',
    title: '[FOR HIRE] n8n expert available for your projects', body_text: 'I am an n8n expert available for hire. Contact me for automation work.',
    poster: 'seller', poster_company: '', posted_at: hoursAgo(2), reply_count: null, __source: 'manual' },
  { post_key: 'manual:aa11bb22cc33', platform: 'manual', url: 'https://example.org/jobs/clay-table',
    title: 'Need help with a Clay table and HubSpot import',
    body_text: 'Our agency is looking for someone to build a Clay enrichment table and import the results into HubSpot. Ongoing work possible for the right person.',
    poster: 'Sam', poster_company: 'Northwind Agency', posted_at: hoursAgo(20), reply_count: null, __source: 'manual' }
];
const selected = [
  Object.assign({}, posts[0], { contact_email: '', contact_hint: 'dm_invited', stated_budget: '', remote_hint: 'remote', matched_stack: 'n8n, HubSpot, Google Sheets, webhooks', intent: 'hiring', gig_score: 92, score_breakdown: 'pin' }),
  Object.assign({}, posts[2], { contact_email: '', contact_hint: 'reply', stated_budget: '', remote_hint: '', matched_stack: 'Clay, HubSpot', intent: 'hiring', gig_score: 71, score_breakdown: 'pin' })
].map(p => { const q = Object.assign({}, p); delete q.__source; return q; });
const J = (a) => a.map(json => ({ json }));
const pin = {
  'Manual Trigger': J([{}]),
  'Fetch Config': J([{ key: 'config_json', value: JSON.stringify(config) }]),
  'Load Manual Gigs': J(posts),
  'Fetch Seen Gigs': J([{}]),
  'Upsert Gig Posts': J([{ result: { inserted: 3, updated: 0 } }]),
  'Expire Old Gigs': J([{ result: { expired: 0, superseded: 0 } }]),
  'Select Gigs to Draft': J(selected),
  'Insert Gig Drafts': J([{ outreach_id: 'pinned' }]),
  'Hot Gig Ping': J([{ id: 'pinned' }]),
  'Write Gig Ops': J([{ run_id: 'pinned' }])
};
process.stdout.write(JSON.stringify(pin));
