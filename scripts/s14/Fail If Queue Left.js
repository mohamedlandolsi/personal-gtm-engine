// Sprint 14 patch: a queue left over is normal. Contact Finder takes contact.max_accounts_per_run (10) per run,
// and Select Contact Batch tops the queue up to that cap. Fail only when the queue is not moving:
// accounts are waiting and neither engine pass of this run wrote a contact.
// Note: GTM Engine: Error Alerts fires for production runs only; a manual run shows the red node instead.
const row = $input.first().json;
const n = Number(row.queued_left || 0);
let runs = row.last_runs;
if (typeof runs === 'string') { try { runs = JSON.parse(runs); } catch (e) { runs = []; } }
runs = Array.isArray(runs) ? runs : [];
const written = runs.reduce((s, r) => s + Number((r && r.contacts_written) || 0), 0);
if (n > 0 && written === 0) throw new Error('GTM Run: ' + n + ' accounts queued but no contacts written this run. Check GTM Contact Finder.');
return [{ json: Object.assign({
  status: n > 0 ? 'ok_queue_draining' : 'ok',
  queued_left: n,
  contacts_written_this_run: written,
  next_step: written > 0 ? 'Run Clay Email Queue, the Clay waterfall and Clay Email Import, then GTM Run again to draft.' : 'Nothing new to enrich.'
}, row) }];
