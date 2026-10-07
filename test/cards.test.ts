import assert from 'node:assert/strict';
import test from 'node:test';

import {
    cardStatementPeriodsForDateRange,
    getCardMovements,
    getCardMovementsForDateRange,
    isCurrentPanamaMonth,
} from '../src/api/cards.js';
import { bank, BankApiError } from '../src/http/client.js';

test('selects the open statement and overlapping cutoff months for a calendar day', () => {
    assert.deepEqual(cardStatementPeriodsForDateRange('2026-10-04', '2026-10-04'), [
        { month: 0, year: 0 },
        { month: 10, year: 2026 },
        { month: 11, year: 2026 },
    ]);
    assert.deepEqual(cardStatementPeriodsForDateRange('2026-12-31', '2026-12-31'), [
        { month: 0, year: 0 },
        { month: 12, year: 2026 },
        { month: 1, year: 2027 },
    ]);
});

test('identifies the current month using Panama local time', () => {
    assert.equal(isCurrentPanamaMonth(10, 2026, Date.UTC(2026, 9, 6, 12)), true);
    assert.equal(isCurrentPanamaMonth(9, 2026, Date.UTC(2026, 9, 6, 12)), false);
});

test('falls back from an unopened current cutoff to the open 0/0 statement', async () => {
    const originalPost = bank.post;
    const calls: Array<{ month: number; year: number }> = [];
    const panamaNow = new Date(Date.now() - 5 * 3_600_000);
    const month = panamaNow.getUTCMonth() + 1;
    const year = panamaNow.getUTCFullYear();

    bank.post = (async (_path: string, body: unknown) => {
        const period = body as { month: number; year: number };
        calls.push({ month: period.month, year: period.year });
        if (calls.length === 1) {
            throw new BankApiError('POST', '/credit-card/find', 400, {
                id: '412',
                name: 'Error de WS',
                statusCode: 412,
            });
        }
        return { associatedCreditCardMovement: [] };
    }) as typeof bank.post;

    try {
        assert.deepEqual(await getCardMovements(3, month, year), []);
        assert.deepEqual(calls, [
            { month, year },
            { month: 0, year: 0 },
        ]);
    } finally {
        bank.post = originalPost;
    }
});

test('calendar range keeps open-period data and ignores unopened cutoff candidates', async () => {
    const originalPost = bank.post;

    bank.post = (async (_path: string, body: unknown) => {
        const { month, year } = body as { month: number; year: number };
        if (month === 0 && year === 0) {
            return {
                associatedCreditCardMovement: [
                    {
                        card: { nameCard: 'test' },
                        movement: [{ id: 'oct-4', dateMovement: Date.UTC(2026, 9, 4, 12) }],
                    },
                ],
            };
        }
        throw new BankApiError('POST', '/credit-card/find', 400, {
            id: '412',
            name: 'Error de WS',
            statusCode: 412,
        });
    }) as typeof bank.post;

    try {
        const movements = await getCardMovementsForDateRange(3, '2026-10-04', '2026-10-04');
        assert.equal(movements.length, 1);
        assert.equal(movements[0]?.id, 'oct-4');
    } finally {
        bank.post = originalPost;
    }
});
