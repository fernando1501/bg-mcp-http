/** Credit-card statements, history and BG's own category breakdown. Plus the pension. */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { findAccount } from '../api/accounts.js';
import {
    getAssociatedCards,
    getCategoryTotals,
    getCardStatement,
    getStatementHistory,
} from '../api/cards.js';
import { getPensionState, getPensionStatement } from '../api/pension.js';
import { toLocalDate } from '../api/normalize.js';
import { errorResult, guarded, jsonResult, validateOptionalPeriod } from './helpers.js';

export function registerCardTools(server: McpServer): void {
    server.registerTool(
        'bg_get_card_statement',
        {
            title: 'Get credit card statement',
            description:
                'Statement for a credit card: balance, minimum payment, cutoff and due dates, credit plans and ' +
                'rates. OMIT month/year for the current open statement (the server sends BG 0/0). Explicit ' +
                'month/year identify a CLOSED statement by cutoff month, not a calendar month, and must be chosen ' +
                'from statementHistory.cutDateLocal. Passing a month whose cutoff has not occurred can produce ' +
                'BG 400 Error de WS. This tool returns the cutoff history needed to choose a historical period.',
            inputSchema: {
                portalId: z.number().int().describe('Credit card portalId from bg_list_accounts.'),
                month: z
                    .number()
                    .int()
                    .min(1)
                    .max(12)
                    .optional()
                    .describe(
                        'Cutoff month from statementHistory for a CLOSED statement. Omit with year for the ' +
                            'current open statement; omission is translated to BG month=0/year=0.',
                    ),
                year: z
                    .number()
                    .int()
                    .min(2000)
                    .max(2100)
                    .optional()
                    .describe(
                        'Cutoff year from statementHistory for a CLOSED statement. Omit with month for the ' +
                            'current open statement.',
                    ),
            },
        },
        guarded(
            async ({ portalId, month, year }: { portalId: number; month?: number; year?: number }) => {
                const periodError = validateOptionalPeriod(month, year);
                if (periodError) return periodError;

                const account = await findAccount(portalId);
                if (!account) {
                    return errorResult(`No product with portalId ${portalId}.`, 'ACCOUNT_NOT_FOUND');
                }
                if (account.classType !== 'CreditCard') {
                    return errorResult(`portalId ${portalId} is not a credit card.`, 'WRONG_ACCOUNT_TYPE');
                }

                const [statement, history, cards] = await Promise.all([
                    getCardStatement(portalId, month ?? 0, year ?? 0),
                    getStatementHistory(portalId).catch(() => null),
                    getAssociatedCards(portalId).catch(() => null),
                ]);

                // The history comes back as raw epochs; add readable dates so the
                // model doesn't have to convert them to pick a period.
                const readableHistory = Array.isArray(history)
                    ? history.map((h: Record<string, unknown>) => ({
                          ...h,
                          cutDateLocal: toLocalDate(h['cutDate'] as number),
                          paymentDateLocal: toLocalDate(h['paymentDate'] as number),
                      }))
                    : history;

                return jsonResult({
                    card: { portalId, alias: account.alias, maskedNumber: account.maskedNumber },
                    period: month && year ? `${year}-${String(month).padStart(2, '0')}` : 'current',
                    statement,
                    statementHistory: readableHistory,
                    associatedCards: cards,
                });
            },
        ),
    );

    server.registerTool(
        'bg_get_card_categories',
        {
            title: 'Get credit card spending by category',
            description:
                "Banco General's own spend-by-category breakdown for a card statement period (Comida y Bebida, " +
                'Transporte, Supermercados, etc.), with transaction counts and totals. OMIT month/year for the ' +
                'current open statement (server sends BG 0/0). Explicit month/year are only for a CLOSED statement ' +
                'whose cutoff appears in bg_get_card_statement.statementHistory; they are not a calendar-month ' +
                'filter. This is the bank\'s categorization, not a computed one.',
            inputSchema: {
                portalId: z.number().int().describe('Credit card portalId from bg_list_accounts.'),
                month: z
                    .number()
                    .int()
                    .min(1)
                    .max(12)
                    .optional()
                    .describe(
                        'Cutoff month for a CLOSED statement listed in statementHistory. Omit with year for the ' +
                            'current open statement; omission is translated to BG 0/0.',
                    ),
                year: z
                    .number()
                    .int()
                    .min(2000)
                    .max(2100)
                    .optional()
                    .describe(
                        'Cutoff year for a CLOSED statement listed in statementHistory. Omit with month for the ' +
                            'current open statement.',
                    ),
            },
        },
        guarded(
            async ({ portalId, month, year }: { portalId: number; month?: number; year?: number }) => {
                const periodError = validateOptionalPeriod(month, year);
                if (periodError) return periodError;

                const account = await findAccount(portalId);
                if (!account) {
                    return errorResult(`No product with portalId ${portalId}.`, 'ACCOUNT_NOT_FOUND');
                }
                if (account.classType !== 'CreditCard') {
                    return errorResult(`portalId ${portalId} is not a credit card.`, 'WRONG_ACCOUNT_TYPE');
                }

                const totals = await getCategoryTotals(portalId, month ?? 0, year ?? 0);
                const rows = Array.isArray(totals) ? totals : [];
                const nonZero = rows.filter(
                    (r: Record<string, unknown>) => Number(r['totalAmount'] ?? 0) !== 0,
                );
                return jsonResult({
                    card: { portalId, alias: account.alias },
                    period: month && year ? `${year}-${String(month).padStart(2, '0')}` : 'current',
                    categories: rows,
                    categoriesWithSpend: nonZero.length,
                    grandTotal: round(
                        rows.reduce(
                            (s: number, r: Record<string, unknown>) => s + Number(r['totalAmount'] ?? 0),
                            0,
                        ),
                    ),
                });
            },
        ),
    );

    server.registerTool(
        'bg_get_pension',
        {
            title: 'Get Pro-Futuro pension detail',
            description:
                'Balances and fund breakdown for the Pro-Futuro pension product, plus the monthly statement ' +
                '(contributions, interest, commissions, withdrawals) when month and year are given.',
            inputSchema: {
                portalId: z.number().int().describe('Pension portalId from bg_list_accounts.'),
                month: z.number().int().min(1).max(12).optional().describe('1-based month for the statement.'),
                year: z.number().int().min(2000).max(2100).optional().describe('Four-digit year.'),
            },
        },
        guarded(
            async ({ portalId, month, year }: { portalId: number; month?: number; year?: number }) => {
                const state = await getPensionState(portalId);
                const statement =
                    month !== undefined && year !== undefined
                        ? await getPensionStatement(portalId, month, year).catch(() => null)
                        : null;
                return jsonResult({
                    portalId,
                    state,
                    statementPeriod:
                        month && year ? `${year}-${String(month).padStart(2, '0')}` : null,
                    statement,
                });
            },
        ),
    );
}

function round(n: number): number {
    return Math.round(n * 100) / 100;
}
