import assert from 'node:assert/strict';
import test from 'node:test';

import app from '../server.js';

const savedEnvironment = {
    token: process.env['MCP_BEARER_TOKEN'],
    username: process.env['BG_USERNAME'],
    password: process.env['BG_PASSWORD'],
    answersJson: process.env['BG_SECURITY_ANSWERS_JSON'],
    answer: process.env['BG_SECURITY_ANSWER'],
};

test.afterEach(() => {
    restore('MCP_BEARER_TOKEN', savedEnvironment.token);
    restore('BG_USERNAME', savedEnvironment.username);
    restore('BG_PASSWORD', savedEnvironment.password);
    restore('BG_SECURITY_ANSWERS_JSON', savedEnvironment.answersJson);
    restore('BG_SECURITY_ANSWER', savedEnvironment.answer);
});

test('rejects MCP requests without a valid credential', async () => {
    process.env['MCP_BEARER_TOKEN'] = 'test-secret';
    const response = await app.request('/mcp', { method: 'POST' });
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('www-authenticate'), 'Bearer');
});

test('reports missing server configuration without exposing values', async () => {
    delete process.env['BG_USERNAME'];
    delete process.env['BG_PASSWORD'];
    delete process.env['BG_SECURITY_ANSWERS_JSON'];
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
        bankSecurityAnswers: false,
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

test('serves an MCP initialize request authenticated by URL token', async () => {
    process.env['MCP_BEARER_TOKEN'] = 'test-secret';
    const response = await app.request('/mcp?token=test-secret', {
        method: 'POST',
        headers: {
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

test('rejects an incorrect URL token', async () => {
    process.env['MCP_BEARER_TOKEN'] = 'test-secret';
    const response = await app.request('/mcp?token=wrong-secret', { method: 'POST' });

    assert.equal(response.status, 401);
});

test('card tools reject an incomplete period before calling Banco General', async () => {
    process.env['MCP_BEARER_TOKEN'] = 'test-secret';

    for (const name of [
        'bg_list_card_transactions',
        'bg_get_card_statement',
        'bg_get_card_categories',
    ]) {
        const response = await app.request('/mcp?token=test-secret', {
            method: 'POST',
            headers: {
                Accept: 'application/json, text/event-stream',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'tools/call',
                params: { name, arguments: { portalId: 1, month: 9 } },
            }),
        });
        const body = (await response.json()) as {
            result?: { isError?: boolean; content?: Array<{ type: string; text?: string }> };
        };
        const resultText = body.result?.content?.find((item) => item.type === 'text')?.text ?? '{}';

        assert.equal(response.status, 200, name);
        assert.equal(body.result?.isError, true, name);
        assert.equal(JSON.parse(resultText).code, 'INVALID_ARGS', name);
    }
});

function restore(name: string, value: string | undefined): void {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
}
