import assert from 'node:assert/strict';
import test from 'node:test';

import app from '../server.js';

const savedEnvironment = {
    token: process.env['MCP_BEARER_TOKEN'],
    username: process.env['BG_USERNAME'],
    password: process.env['BG_PASSWORD'],
    answer: process.env['BG_SECURITY_ANSWER'],
};

test.afterEach(() => {
    restore('MCP_BEARER_TOKEN', savedEnvironment.token);
    restore('BG_USERNAME', savedEnvironment.username);
    restore('BG_PASSWORD', savedEnvironment.password);
    restore('BG_SECURITY_ANSWER', savedEnvironment.answer);
});

test('rejects MCP requests without the fixed bearer token', async () => {
    process.env['MCP_BEARER_TOKEN'] = 'test-secret';
    const response = await app.request('/mcp', { method: 'POST' });
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('www-authenticate'), 'Bearer');
});

test('reports missing server configuration without exposing values', async () => {
    delete process.env['BG_USERNAME'];
    delete process.env['BG_PASSWORD'];
    delete process.env['BG_SECURITY_ANSWER'];
    process.env['MCP_BEARER_TOKEN'] = 'test-secret';

    const response = await app.request('/health');
    const body = (await response.json()) as {
        status: string;
        configuration: Record<string, boolean>;
    };

    assert.equal(response.status, 503);
    assert.equal(body.status, 'misconfigured');
    assert.deepEqual(body.configuration, {
        mcpBearerToken: true,
        bankUsername: false,
        bankPassword: false,
        bankSecurityAnswer: false,
    });
    assert.equal(JSON.stringify(body).includes('test-secret'), false);
});

test('serves an authenticated MCP initialize request over JSON HTTP', async () => {
    process.env['MCP_BEARER_TOKEN'] = 'test-secret';
    const response = await app.request('/mcp', {
        method: 'POST',
        headers: {
            Authorization: 'Bearer test-secret',
            Accept: 'application/json, text/event-stream',
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
                protocolVersion: '2025-06-18',
                capabilities: {},
                clientInfo: { name: 'test-client', version: '1.0.0' },
            },
        }),
    });
    const body = (await response.json()) as {
        result?: { serverInfo?: { name?: string } };
    };

    assert.equal(response.status, 200);
    assert.equal(body.result?.serverInfo?.name, 'bg-mcp-http');
});

function restore(name: string, value: string | undefined): void {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
}
