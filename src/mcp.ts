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
                'Panama local time (UTC-5). Balances reflect Banco General\'s lastSyncDate. Credit-card month/year ' +
                'identify a CLOSED statement by its cutoff month, not a calendar month. For the current open ' +
                'statement or any recent date after the latest cutoff, OMIT both month and year; the server then ' +
                'sends Banco General month=0/year=0. Never pass the current calendar month/year merely to search ' +
                'for a date, because BG returns 400 Error de WS for a statement that has not closed. To choose a ' +
                'historical period, first read statementHistory from bg_get_card_statement and use the month/year ' +
                'of an available cutDateLocal. When verifying an exact credit-card day or calendar range, prefer ' +
                'bg_list_card_transactions with fromDate/toDate; the server selects 0/0 and relevant closed ' +
                'statements automatically and matches both the posting date and BG effective date.',
        },
    );

    registerAccountTools(server);
    registerTransactionTools(server);
    registerCardTools(server);
    registerAnalyticsTools(server);
    return server;
}
