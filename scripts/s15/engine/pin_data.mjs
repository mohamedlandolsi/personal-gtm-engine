// Sprint 15: pin data for test_workflow on the engine (prints JSON). Every Sheets, Postgres, Data Table and HTTP node is
// pinned, so nothing is written. Partner Directories Source is NOT pinned: it reads the live directory pages.
import fs from 'node:fs';
const full = JSON.parse(fs.readFileSync('config/config.example.json', 'utf8'));
// Only the keys the path up to Process Accounts reads, so the pin stays small.
const pick = (o, ks) => Object.fromEntries(ks.filter(k => k in o).map(k => [k, o[k]]));
const config = pick(full, ['enabled', 'max_companies_per_run', 'min_account_score', 'priority_score', 'allow_agencies', 'allow_startups', 'allow_smb', 'allow_enterprise', 'timezone', 'company', 'scoring', 'lead_tracks']);
config.rev = 'pin-test-phase4';
config.sources = { partner_directories: full.sources.partner_directories, apollo: { enabled: false }, hn_hiring: { enabled: false }, yc_directory: { enabled: false } };
config.enrichment = { enabled: false }; config.clay = { enabled: false }; config.clay_contacts = { enabled: false }; config.outreach = { enabled: false };
const J = (a) => a.map(json => ({ json }));
const E = J([{}]);
const seed = (o) => Object.assign({ row_number: 2, company_name: '', domain: '', website: '', industry: '', company_type: '', employee_count: '', location_raw: '',
  country: '', timezone_utc_offset: '', funding_stage: '', description: '', notes: '', status: 'new', lead_track: '', source: '' }, o);
const pin = {
  'Manual Trigger': E,
  'Fetch Config': J([{ key: 'config_json', value: JSON.stringify(config), type: 'json', description: '', updated_at: '' }]),
  'Fetch Seeds': J([
    seed({ company_name: 'Pin Agency', domain: 'pin-agency.example', website: 'https://pin-agency.example', industry: 'revops consulting', company_type: 'agency',
      employee_count: 8, location_raw: 'Lisbon, Portugal', country: 'Portugal', timezone_utc_offset: 0, funding_stage: 'unknown',
      description: 'Small RevOps agency building HubSpot and Clay workflows for B2B clients.', lead_track: 'agency_partner', source: 'hubspot_directory' }),
    seed({ row_number: 3, company_name: 'Pin Saas', domain: 'pin-saas.example', website: 'https://pin-saas.example', industry: 'b2b saas', company_type: 'startup',
      employee_count: 30, location_raw: 'Berlin, Germany', country: 'Germany', timezone_utc_offset: 1, funding_stage: 'seed',
      description: 'B2B SaaS with HubSpot CRM and revops automation needs.' })]),
  'HN Hiring Source': J([{ __skipped: 'hn_hiring pinned in test' }]),
  'YC Directory Source': J([{ __skipped: 'yc_directory pinned in test' }]),
  'Fetch Seen Profiles': E, 'Remember Profiles': E,
  'Fetch Seen Accounts': J([{ domain: '__placeholder__' }]), 'Only New Domain': E, 'Remember Domain': E,
  'Append Accounts': E, 'Append Ops': E,
  'Fetch Accounts Pending': E, 'Fetch Website': E, 'Update Accounts': E,
  'Fetch Accounts For Clay': E, 'Append Clay Queue': E, 'Update Accounts Queued': E, 'Fetch Clay Results': E, 'Update Accounts Clay': E,
  'Fetch Qualified Accounts': E, 'Fetch Seen Contacts': E, 'Fetch Contact Results': E, 'Append Contacts Queue': E, 'Update Accounts Contact Queued': E,
  'Append Contacts': E, 'Only New Contact': E, 'Remember Contact': E, 'Update Accounts Rescored': E,
  'Fetch Contacts For Outreach': E, 'Fetch Accounts For Outreach': E, 'Fetch Outreach Queue': E, 'Fetch Outreach Blocks': E,
  'Append Outreach Queue': E, 'Update Contacts Used': E
};
process.stdout.write(JSON.stringify(pin));
