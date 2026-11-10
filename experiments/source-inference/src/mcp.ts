import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { browserAdapter } from './browser-adapter.js';

export function createMcpServer(adapter: ReturnType<typeof browserAdapter>) {
  const server = new Server({ name: 'angular-mcp-compiler', version: '0.1.0' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: adapter.tools }));
  server.setRequestHandler(CallToolRequestSchema, async request => {
    try {
      const result = await adapter.invoke(request.params.name, request.params.arguments ?? {});
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], structuredContent: result };
    } catch (error) {
      return { isError: true, content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }] };
    }
  });
  return server;
}
