import { hash } from './hash.js';
import type { Approval, Capability, Manifest, ToolDefinition } from './model.js';

export function toolName(capability: Capability) {
  return `angular_${capability.handler.replace(/[^a-zA-Z0-9_]/g, '_')}_${hash(capability.id).slice(0, 10)}`;
}

export function reviewedTools(manifest: Manifest, approvals: Approval[]): { capability: Capability; tool: ToolDefinition }[] {
  if (!Array.isArray(approvals)) throw new Error('Approvals must be an array');
  const seen = new Set<string>();
  return approvals.map(approval => {
    if (!approval || typeof approval.id !== 'string' || seen.has(approval.id)) throw new Error('Invalid or duplicate approval');
    seen.add(approval.id);
    const capability = manifest.capabilities.find(c => c.id === approval.id);
    if (!capability) throw new Error(`Approval refers to a missing capability: ${approval.id}`);
    // The fingerprint must describe the contract that is actually served, not just a stored string.
    const expected = hash(JSON.stringify({ sourceDigest: manifest.sourceDigest, capability: { ...capability, fingerprint: '' } }));
    if (capability.fingerprint !== expected) throw new Error(`Manifest content does not match its fingerprint for ${approval.id}; regenerate the manifest`);
    if (approval.fingerprint !== capability.fingerprint) throw new Error(`Stale approval for ${approval.id}; inspect the new source and review it again`);
    if (capability.status !== 'candidate') throw new Error(`Blocked capability cannot be approved: ${approval.id}`);
    if (!['read', 'write'].includes(approval.effect) || typeof approval.description !== 'string' || !approval.description.trim()) throw new Error('Approval needs a description and explicit read/write effect');
    // A mutating operation cannot be approved as read-only (MCP clients may auto-run read-only tools).
    // `read` is only for operations that demonstrably fetch: every traced call looks like a query, nothing dispatches to a store,
    // nothing was left untraced (ui-state), and no storage is written. Everything else must be approved as `write`.
    const looksLikeRead = capability.bindings.length > 0 && capability.effectKind !== 'ui-state' && !capability.plan?.effect
      && capability.bindings.every(b => b.token !== 'Store' && /^(get|list|find|search|load|fetch|query|read|check|view|count|lookup|retrieve|select)/i.test(b.method));
    // What the sandbox actually saw trumps what the names suggest.
    if (approval.effect === 'read' && capability.observed && ['write', 'navigation', 'opens-overlay'].includes(capability.observed.effectClass))
      throw new Error(`${approval.id} was observed to ${capability.observed.effectClass === 'write' ? 'change state' : capability.observed.effectClass} when executed; approve it with effect "write"`);
    if (approval.effect === 'read' && !looksLikeRead)
      throw new Error(`${approval.id} is not demonstrably read-only (it dispatches, mutates, writes storage or its effects could not be traced); approve it with effect "write"`);
    const requiredContext=typeof capability.contextSchema==='object'&&Array.isArray(capability.contextSchema.required)?capability.contextSchema.required.filter((name):name is string=>typeof name==='string'):[];
    const description=approval.description+(requiredContext.length?` Requires explicit runtime context (${requiredContext.join(', ')}), configured by the host via browserAdapter options.context or WebMCP install({context}) before calling. It is separate from tool arguments; no source container is guessed.`:'');
    return { capability, tool: { name: toolName(capability), description, inputSchema: capability.inputSchema, outputSchema: capability.outputSchema,
      annotations: { readOnlyHint: approval.effect === 'read', destructiveHint: approval.effect === 'write', openWorldHint: true } } };
  });
}
