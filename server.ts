import { timingSafeEqual } from 'node:crypto';

import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { Hono } from 'hono';

import { configurationStatus, getBearerToken } from './src/config.js';
import { createMcpServer } from './src/mcp.js';

const app = new Hono();

app.get('/', (context) =>
    context.json({
        service: 'bg-mcp-http',
        transport: 'MCP Streamable HTTP',
        endpoint: '/mcp',
        health: '/health',
    }),
);

app.get('/health', (context) => {
    const configuration = configurationStatus();
    const ready = Object.values(configuration).every(Boolean);
    return context.json({ status: ready ? 'ok' : 'misconfigured', configuration }, ready ? 200 : 503);
});

app.all('/mcp', async (context) => {
    if (!hasValidBearer(context.req.header('authorization'))) {
        return context.json(
            {
                jsonrpc: '2.0',
                error: { code: -32001, message: 'Unauthorized' },
                id: null,
            },
            401,
            { 'WWW-Authenticate': 'Bearer' },
        );
    }

    if (context.req.method !== 'POST') {
        return context.json(
            {
                jsonrpc: '2.0',
                error: { code: -32000, message: 'Method not allowed; use POST for stateless MCP.' },
                id: null,
            },
            405,
            { Allow: 'POST' },
        );
    }

    const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
    });
    const server = createMcpServer();

    try {
        await server.connect(transport);
        return await transport.handleRequest(context.req.raw);
    } catch (error) {
        console.error('MCP request failed', error);
        return context.json(
            {
                jsonrpc: '2.0',
                error: { code: -32603, message: 'Internal server error' },
                id: null,
            },
            500,
        );
    }
});

function hasValidBearer(authorization: string | undefined): boolean {
    let expected: string;
    try {
        expected = getBearerToken();
    } catch {
        return false;
    }
    if (!authorization?.startsWith('Bearer ')) return false;
    const supplied = authorization.slice('Bearer '.length);
    const suppliedBuffer = Buffer.from(supplied);
    const expectedBuffer = Buffer.from(expected);
    return suppliedBuffer.length === expectedBuffer.length && timingSafeEqual(suppliedBuffer, expectedBuffer);
}

export default app;
