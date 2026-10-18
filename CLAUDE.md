# Personal GTM Engine: rules for Claude Code

## n8n access
- n8n is the source of truth. Edit workflows ONLY through the n8n MCP tools. Never edit files in workflows/ to change behavior; those are sanitized snapshots.
- Workflow IDs:
  - SANDBOX Personal GTM Engine: <id>
  - Personal GTM Engine: AlDFQcPA9KyItHZq
  - GTM Contact Finder: XZNsJ8Wnhc1CNxPc
  - Personal GTM Digest: tiUfanwKACM8qdlv
  - GTM Neon Sync: oVuFHj1w20pt9uie

## Edit protocol (always, in this order)
1. get_workflow_details on the target workflow right before editing. Never rely on an earlier read; the user edits in the UI too.
2. Explain the planned change as a short list (node, field, old, new) and wait for "go".
3. Build the change, run validate_workflow, fix until valid.
4. Apply with update_workflow using the smallest operations possible (setNodeParameter / updateNodeParameters). Never recreate a workflow that already exists.
5. Report what changed, then stop. Do not publish.

## Hard rules
- NEVER call publish_workflow or unpublish_workflow. The user publishes in the UI.
- NEVER use renameNode on existing nodes. Code nodes reference other nodes by exact name ($('Node Name')).
- NEVER call execute_workflow in production mode. Prefer test_workflow (pins Sheets/HTTP/credentialed nodes). Ask before any manual-mode run, because it writes to the real Google Sheet and Discord.
- Never touch credentials except via setNodeCredential with an ID from list_credentials, and only when asked.
- Deterministic gates before LLM calls; free tiers only; no em dashes in any text you write into nodes.
- Before using a node type, call search_nodes / get_node_types. Do not guess parameter names or typeVersions.

## Git
- After an accepted change: export, sanitize, commit (see docs/SETUP.md section 8).