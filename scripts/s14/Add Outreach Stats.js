const safeAll = (name) => { try { return $(name).all().map(i => i.json); } catch (e) { return []; } };
const base = JSON.parse(JSON.stringify($input.first().json));
base.stats = base.stats || {};
const prev = base.stats.outreach || {};
const all = safeAll('Draft Outreach');
const rows = all.filter(r => r && r.contact_id);
// Sprint 14: drafted = pending rows only. Failed drafts, gate rows and unreachable sites are counted on their own.
const by = (status) => rows.filter(r => String(r.approval_status || '') === status).length;
const gate = (name) => rows.filter(r => String(r.llm_provider || '') === 'gate:' + name).length;
const ds = (all.find(r => r && r.__draft_stats) || {}).__draft_stats;
base.stats.outreach = Object.assign({}, prev, {
  drafted: by('pending'),
  needs_redraft: by('needs_redraft'),
  skipped_gate_overlap: gate('product_overlap'),
  skipped_gate_hardware: gate('hardware'),
  skipped_gate_no_angle: gate('no_angle'),
  // From the Draft Outreach stats. With no row at all, every selected pair was unreachable.
  skipped_site_unreachable: ds ? (Number(ds.skipped_site_unreachable) || 0) : Math.max(0, (Number(prev.pairs) || 0) - rows.length),
  llm_calls: rows.reduce((s, r) => s + (Number(r.llm_calls) || 0), 0),
  llm_failures: rows.reduce((s, r) => s + (Number(r.llm_failures) || 0), 0),
  template_fallbacks: rows.filter(r => r.llm_provider === 'template').length
});
return [{ json: base }];