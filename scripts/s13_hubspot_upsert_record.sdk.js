// Sprint 13: n8n Workflow SDK code for the sub-workflow "HubSpot Upsert Record" (11 nodes).
// Reference copy of what section 6.2 builds by hand. Validated with the n8n MCP validate_workflow on 2026-10-26.
// Cowork can pass it to create_workflow_from_code if you choose to skip the hand build.
// One HubSpot write per call: update by id, else search by key and adopt, else create with associations.

import { workflow, node, trigger, ifElse, expr, newCredential } from '@n8n/workflow-sdk';

const start = trigger({
  type: 'n8n-nodes-base.executeWorkflowTrigger', version: 1.1,
  config: { name: 'Start', position: [0, 300], parameters: { inputSource: 'workflowInputs', workflowInputs: { values: [
    { name: 'link_type', type: 'string' }, { name: 'object', type: 'string' }, { name: 'local_id', type: 'string' },
    { name: 'hubspot_id', type: 'string' }, { name: 'key_property', type: 'string' }, { name: 'key_value', type: 'string' },
    { name: 'properties', type: 'object' }, { name: 'associations', type: 'array' }, { name: 'properties_hash', type: 'string' } ] } } }
});
const hasId = ifElse({ version: 2.2, config: { name: "Has HubSpot ID", position: [220,300], parameters: { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' }, conditions: [{"leftValue":expr("{{ $json.hubspot_id }}"),"operator":{"type":"string","operation":"notEmpty","singleValue":true}}], combinator: 'and' } } } });
const hasKey = ifElse({ version: 2.2, config: { name: "Has Search Key", position: [440,440], parameters: { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' }, conditions: [{"leftValue":expr("{{ $json.key_value }}"),"operator":{"type":"string","operation":"notEmpty","singleValue":true}}], combinator: 'and' } } } });
const found = ifElse({ version: 2.2, config: { name: "Found Existing", position: [880,360], parameters: { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' }, conditions: [{"leftValue":expr("{{ $json.total }}"),"operator":{"type":"number","operation":"gt"},"rightValue":0}], combinator: 'and' } } } });
const updById = node({
  type: 'n8n-nodes-base.httpRequest', version: 4.5,
  config: {
    name: "Update By ID", position: [660,140], onError: 'continueErrorOutput', retryOnFail: true, maxTries: 3, waitBetweenTries: 2000,
    parameters: {
      method: "PATCH", url: expr("https://api.hubapi.com/crm/objects/2026-09/{{ $('Start').item.json.object }}/{{ $('Start').item.json.hubspot_id }}"),
      authentication: 'predefinedCredentialType', nodeCredentialType: 'hubspotAppToken',
      sendBody: true, contentType: 'json', specifyBody: 'json', jsonBody: expr("{{ JSON.stringify({ properties: $('Start').item.json.properties }) }}"),
      options: { timeout: 15000 }
    },
    credentials: { hubspotAppToken: newCredential('HubSpot Service Key') }
  }
});
const search = node({
  type: 'n8n-nodes-base.httpRequest', version: 4.5,
  config: {
    name: "Search By Key", position: [660,360], onError: 'continueErrorOutput', retryOnFail: true, maxTries: 3, waitBetweenTries: 2000,
    parameters: {
      method: "POST", url: expr("https://api.hubapi.com/crm/objects/2026-09/{{ $('Start').item.json.object }}/search"),
      authentication: 'predefinedCredentialType', nodeCredentialType: 'hubspotAppToken',
      sendBody: true, contentType: 'json', specifyBody: 'json', jsonBody: expr("{{ JSON.stringify({ filterGroups: [{ filters: [{ propertyName: $('Start').item.json.key_property, operator: 'EQ', value: $('Start').item.json.key_value }] }], properties: ['hs_object_id'], limit: 1 }) }}"),
      options: { timeout: 15000 }
    },
    credentials: { hubspotAppToken: newCredential('HubSpot Service Key') }
  }
});
const updFound = node({
  type: 'n8n-nodes-base.httpRequest', version: 4.5,
  config: {
    name: "Update Found", position: [1100,300], onError: 'continueErrorOutput', retryOnFail: true, maxTries: 3, waitBetweenTries: 2000,
    parameters: {
      method: "PATCH", url: expr("https://api.hubapi.com/crm/objects/2026-09/{{ $('Start').item.json.object }}/{{ $json.results[0].id }}"),
      authentication: 'predefinedCredentialType', nodeCredentialType: 'hubspotAppToken',
      sendBody: true, contentType: 'json', specifyBody: 'json', jsonBody: expr("{{ JSON.stringify({ properties: $('Start').item.json.properties }) }}"),
      options: { timeout: 15000 }
    },
    credentials: { hubspotAppToken: newCredential('HubSpot Service Key') }
  }
});
const create = node({
  type: 'n8n-nodes-base.httpRequest', version: 4.5,
  config: {
    name: "Create Record", position: [1100,540], onError: 'continueErrorOutput', retryOnFail: true, maxTries: 3, waitBetweenTries: 2000,
    parameters: {
      method: "POST", url: expr("https://api.hubapi.com/crm/objects/2026-09/{{ $('Start').item.json.object }}"),
      authentication: 'predefinedCredentialType', nodeCredentialType: 'hubspotAppToken',
      sendBody: true, contentType: 'json', specifyBody: 'json', jsonBody: expr("{{ JSON.stringify({ properties: $('Start').item.json.properties, associations: $('Start').item.json.associations }) }}"),
      options: { timeout: 15000 }
    },
    credentials: { hubspotAppToken: newCredential('HubSpot Service Key') }
  }
});
const ok = node({ type: 'n8n-nodes-base.set', version: 3.4, config: { name: "Shape Result", position: [1340,220], parameters: { mode: 'manual', includeOtherFields: false, assignments: { assignments: [
      { id: "lt", name: "link_type", value: expr("{{ $('Start').item.json.link_type }}"), type: "string" },
      { id: "li", name: "local_id", value: expr("{{ $('Start').item.json.local_id }}"), type: "string" },
      { id: "ph", name: "properties_hash", value: expr("{{ $('Start').item.json.properties_hash }}"), type: "string" },
      { id: "ok", name: "ok", value: true, type: "boolean" },
      { id: "ac", name: "action", value: expr("{{ ({ 'Update By ID': 'updated', 'Update Found': 'adopted', 'Create Record': 'created' })[$prevNode.name] }}"), type: "string" },
      { id: "hi", name: "hubspot_id", value: expr("{{ $json.id }}"), type: "string" },
      { id: "er", name: "error", value: "", type: "string" }
  ] } } } });
const bad = node({ type: 'n8n-nodes-base.set', version: 3.4, config: { name: "Shape Error", position: [1340,500], parameters: { mode: 'manual', includeOtherFields: false, assignments: { assignments: [
      { id: "lt", name: "link_type", value: expr("{{ $('Start').item.json.link_type }}"), type: "string" },
      { id: "li", name: "local_id", value: expr("{{ $('Start').item.json.local_id }}"), type: "string" },
      { id: "ph", name: "properties_hash", value: expr("{{ $('Start').item.json.properties_hash }}"), type: "string" },
      { id: "ok", name: "ok", value: false, type: "boolean" },
      { id: "ac", name: "action", value: "failed", type: "string" },
      { id: "hi", name: "hubspot_id", value: expr("{{ $('Start').item.json.hubspot_id }}"), type: "string" },
      { id: "er", name: "error", value: expr("{{ ($prevNode.name + ': ' + ($json.error?.description || $json.error?.message || JSON.stringify($json))).slice(0, 500) }}"), type: "string" }
  ] } } } });
const ret = node({ type: 'n8n-nodes-base.noOp', version: 1, config: { name: 'Return', position: [1580, 360] } });

export default workflow('hubspot-upsert-record', 'HubSpot Upsert Record')
  .add(start)
  .to(hasId.onTrue(updById).onFalse(hasKey.onTrue(search).onFalse(create)))
  .add(search.output(0).to(found.onTrue(updFound).onFalse(create)))
  .add(updById.output(0).to(ok))
  .add(updById.output(1).to(bad))
  .add(search.output(1).to(bad))
  .add(updFound.output(0).to(ok))
  .add(updFound.output(1).to(bad))
  .add(create.output(0).to(ok))
  .add(create.output(1).to(bad))
  .add(ok.to(ret))
  .add(bad.to(ret));
