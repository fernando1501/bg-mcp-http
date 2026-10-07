import assert from 'node:assert/strict';
import test from 'node:test';

import { listAccounts } from '../src/api/accounts.js';
import { bank, SessionExpiredError } from '../src/http/client.js';

const validProductList = [
    {
        products: [
            {
                accounts: [
                    {
                        portalId: 7,
                        classType: 'SavingsAccount',
                        alias: 'Test account',
                        maskedNumber: '**** 0007',
                    },
                ],
            },
        ],
    },
];

test('retries the product list after invalidating a misleading HTTP 200 session', async () => {
    const responses: unknown[] = [{ login: true }, validProductList];
    const originalGet = bank.get;
    const originalInvalidateSession = bank.invalidateSession;
    let getCalls = 0;
    let invalidations = 0;

    bank.get = (async () => {
        getCalls += 1;
        return responses.shift();
    }) as typeof bank.get;
    bank.invalidateSession = (() => {
        invalidations += 1;
    }) as typeof bank.invalidateSession;

    try {
        const accounts = await listAccounts();
        assert.equal(getCalls, 2);
        assert.equal(invalidations, 1);
        assert.equal(accounts[0]?.portalId, 7);
    } finally {
        bank.get = originalGet;
        bank.invalidateSession = originalInvalidateSession;
    }
});

test('clears the failed replacement session and stops after one retry', async () => {
    const originalGet = bank.get;
    const originalInvalidateSession = bank.invalidateSession;
    let getCalls = 0;
    let invalidations = 0;

    bank.get = (async () => {
        getCalls += 1;
        return { login: true };
    }) as typeof bank.get;
    bank.invalidateSession = (() => {
        invalidations += 1;
    }) as typeof bank.invalidateSession;

    try {
        await assert.rejects(
            listAccounts(),
            (error: unknown) =>
                error instanceof SessionExpiredError &&
                error.code === 'SESSION_EXPIRED' &&
                /after an automatic re-login/.test(error.message),
        );
        assert.equal(getCalls, 2);
        assert.equal(invalidations, 2);
    } finally {
        bank.get = originalGet;
        bank.invalidateSession = originalInvalidateSession;
    }
});
