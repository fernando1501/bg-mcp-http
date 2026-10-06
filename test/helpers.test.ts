import assert from 'node:assert/strict';
import test from 'node:test';

import { validateOptionalPeriod } from '../src/tools/helpers.js';

test('accepts a complete card period or an omitted card period', () => {
    assert.equal(validateOptionalPeriod(undefined, undefined), null);
    assert.equal(validateOptionalPeriod(9, 2026), null);
});

test('rejects a card period with only month or only year', () => {
    for (const [month, year] of [
        [9, undefined],
        [undefined, 2026],
    ] as const) {
        const result = validateOptionalPeriod(month, year);
        assert.equal(result?.isError, true);
        assert.deepEqual(JSON.parse(result?.content[0]?.text ?? '{}'), {
            error: 'month and year must be provided together, or both omitted.',
            code: 'INVALID_ARGS',
        });
    }
});
