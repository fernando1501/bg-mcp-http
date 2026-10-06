import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { registerAccountTools } from './tools/accounts.tools.js';
import { registerAnalyticsTools } from './tools/analytics.tools.js';
import { registerCardTools } from './tools/cards.tools.js';
import { registerTransactionTools } from './tools/transactions.tools.js';

export function createMcpServer(): McpServer {
    const server = new McpServer(
        { name: 'bg-mcp-http', version: '1.0.0' },
        {
            instructions:
                'Read-only access to Banco General accounts. Authentication to the bank is automatic and ' +
                'server-side; never ask the user for bank credentials and never attempt to call login tools. ' +
                'Start with bg_list_accounts to obtain the portalId required by the other tools. All dates are ' +
                'Panama local time (UTC-5). Balances reflect Banco General\'s lastSyncDate.',
        },
    );

    registerAccountTools(server);
    registerTransactionTools(server);
    registerCardTools(server);
    registerAnalyticsTools(server);
    return server;
}
