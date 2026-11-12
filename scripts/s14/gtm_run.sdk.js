import { workflow, node, trigger, sticky } from '@n8n/workflow-sdk';

// Sprint 14 Phase 6.1: GTM Run. One manual click runs the whole batch in order and fails loudly
// when accounts are still waiting for contacts (guide table 6.1, ADR-105).

const manualTrigger = trigger({
  type: 'n8n-nodes-base.manualTrigger',
  version: 1,
  config: { name: 'Manual Trigger', position: [0, 200] }
});

const syncBefore = node({
  type: 'n8n-nodes-base.executeWorkflow',
  version: 1.3,
  config: {
    name: 'Sync Before',
    position: [224, 200],
    parameters: {
      source: 'database',
      workflowId: { __rl: true, mode: 'id', value: 'oVuFHj1w20pt9uie', cachedResultName: 'GTM Neon Sync' },
      mode: 'once',
      options: { waitForSubWorkflow: true }
    }
  }
});

const enginePass1 = node({
  type: 'n8n-nodes-base.executeWorkflow',
  version: 1.3,
  config: {
    name: 'Engine Pass 1',
    position: [448, 200],
    parameters: {
      source: 'database',
      workflowId: { __rl: true, mode: 'id', value: 'AlDFQcPA9KyItHZq', cachedResultName: 'Personal GTM Engine' },
      mode: 'once',
      options: { waitForSubWorkflow: true }
    }
  }
});

const contactFinder = node({
  type: 'n8n-nodes-base.executeWorkflow',
  version: 1.3,
  config: {
    name: 'Contact Finder',
    position: [672, 200],
    parameters: {
      source: 'database',
      workflowId: { __rl: true, mode: 'id', value: 'XZNsJ8Wnhc1CNxPc', cachedResultName: 'GTM Contact Finder' },
      mode: 'once',
      options: { waitForSubWorkflow: true }
    }
  }
});

const enginePass2 = node({
  type: 'n8n-nodes-base.executeWorkflow',
  version: 1.3,
  config: {
    name: 'Engine Pass 2',
    position: [896, 200],
    parameters: {
      source: 'database',
      workflowId: { __rl: true, mode: 'id', value: 'AlDFQcPA9KyItHZq', cachedResultName: 'Personal GTM Engine' },
      mode: 'once',
      options: { waitForSubWorkflow: true }
    }
  }
});

const syncAfter = node({
  type: 'n8n-nodes-base.executeWorkflow',
  version: 1.3,
  config: {
    name: 'Sync After',
    position: [1120, 200],
    parameters: {
      source: 'database',
      workflowId: { __rl: true, mode: 'id', value: 'oVuFHj1w20pt9uie', cachedResultName: 'GTM Neon Sync' },
      mode: 'once',
      options: { waitForSubWorkflow: true }
    }
  }
});

const readRunResult = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.7,
  config: {
    name: 'Read Run Result',
    position: [1344, 200],
    executeOnce: true,
    parameters: {
      operation: 'executeQuery',
      query: "select (select count(*)::int from accounts where contact_status = 'queued' and coalesce(status,'') <> 'rejected') as queued_left,\n       (select json_agg(o) from (select run_at, accounts_written, contacts_written, outreach_drafts_written,\n          llm_calls, llm_failures, rejection_summary from ops order by run_at desc limit 2) o) as last_runs;",
      options: {}
    },
    credentials: { postgres: { id: 'lMhT2jiDIkXMv4Zl', name: 'Neon GTM' } }
  }
});

const failIfQueueLeft = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Fail If Queue Left',
    position: [1568, 200],
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: "// Sprint 14: the designed signal. Accounts still queued for contacts means one more GTM Run.\n// The throw fails the run, so GTM Engine: Error Alerts posts the message.\nconst row = $input.first().json;\nconst n = Number(row.queued_left || 0);\nif (n > 0) throw new Error('GTM Run: ' + n + ' accounts still queued for contacts. Run GTM Run again.');\nreturn [{ json: row }];"
    }
  }
});

const readme = sticky(
  '## GTM Run\nOne click runs the batch in order: Neon Sync, Engine, Contact Finder, Engine, Neon Sync.\n\n**Run:** manual. Each step waits for the one before it.\n**Fails on purpose** when accounts are still queued for contacts: run it again.\n**On failure:** GTM Engine: Error Alerts.',
  [], { position: [0, -160], width: 520, height: 300 }
);

export default workflow('gtm-run', 'GTM Run', { settings: { executionOrder: 'v1', errorWorkflow: 'CEc6gDLm2WD7mgXl' } })
  .add(manualTrigger)
  .to(syncBefore)
  .to(enginePass1)
  .to(contactFinder)
  .to(enginePass2)
  .to(syncAfter)
  .to(readRunResult)
  .to(failIfQueueLeft)
  .add(readme);
