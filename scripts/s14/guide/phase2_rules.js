// Fix 3: buying-role score from the title. CEO first, then technical words win over "founder".
const buyerScore = (title) => {
  const t = String(title || '').toLowerCase();
  if (/\bceo\b|chief executive|managing director|general manager|gerente|directeur g.n.ral|gesch.ftsf.hrer/.test(t)) return 100;
  if (/\bcto\b|chief technology|engineer|engineering|head of product|chief product|\bcpo\b|developer|technical|scientist/.test(t)) return 30;
  if (/\bcoo\b|chief operating|\bcro\b|chief revenue|head of (?:growth|revops|revenue operations|operations|sales|marketing)|vp,? (?:sales|marketing|growth)|revops|sales ops|marketing ops/.test(t)) return 90;
  if (/\b(?:co-?)?founder\b|fundador|fondat|gr.nder/.test(t)) return 70;
  return 40;
};

// Fix 6: a trigger counts only if it is an event of a known type, dated, or a named hiring role.
const TRIGGER_TYPES = ['hiring', 'funding', 'news', 'launch'];
const validTrigger = (a) => {
  const type = String(a.clay_trigger_source || '').toLowerCase();
  const text = String(a.clay_trigger || '').trim();
  const dated = /^\d{4}-\d{2}-\d{2}$/.test(String(a.clay_trigger_date || ''));
  const role = /hiring|account executive|\bsdr\b|\bbdr\b|revops|operations|\bops\b|sales|marketing|growth|\bgtm\b|manager|head of|lead/i.test(text);
  return !!text && TRIGGER_TYPES.includes(type) && (dated || (type === 'hiring' && role));
};

// Fix 10: region is a sort preference, not part of final_score (ADR-109).
const EU_UK = ['austria','belgium','bulgaria','croatia','cyprus','czechia','czech republic','denmark','estonia','finland','france','germany','greece','hungary','ireland','italy','latvia','lithuania','luxembourg','malta','netherlands','poland','portugal','romania','slovakia','slovenia','spain','sweden','united kingdom','norway','iceland','liechtenstein','switzerland'];
