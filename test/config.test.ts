import assert from 'node:assert/strict';
import test from 'node:test';

import {
    normalizeSecurityQuestion,
    parseSecurityAnswers,
    resolveSecurityAnswer,
} from '../src/config.js';

test('normalizes harmless security-question formatting differences', () => {
    assert.equal(
        normalizeSecurityQuestion('  ¿CUÁL   es tu mascota?  '),
        normalizeSecurityQuestion('¿Cuál es tu mascota'),
    );
});

test('selects the answer that belongs to the question returned by the bank', () => {
    const securityAnswers = parseSecurityAnswers(
        JSON.stringify({
            '¿Cuál es tu mascota?': 'Firulais',
            '¿En qué ciudad naciste?': 'Panamá',
        }),
    );

    assert.equal(
        resolveSecurityAnswer('¿EN QUÉ CIUDAD NACISTE?', { securityAnswers }),
        'Panamá',
    );
    assert.equal(resolveSecurityAnswer('Pregunta desconocida', { securityAnswers }), null);
});

test('supports the deprecated single-answer fallback', () => {
    assert.equal(
        resolveSecurityAnswer('Cualquier pregunta', {
            securityAnswers: {},
            legacySecurityAnswer: 'legacy-answer',
        }),
        'legacy-answer',
    );
});

test('does not use a legacy fallback when a JSON answer map is active', () => {
    const securityAnswers = parseSecurityAnswers('{"Known question":"known-answer"}');
    assert.equal(
        resolveSecurityAnswer('Unknown question', {
            securityAnswers,
            legacySecurityAnswer: undefined,
        }),
        null,
    );
});

test('rejects malformed or empty answer maps', () => {
    assert.throws(() => parseSecurityAnswers('not-json'), /valid JSON object/);
    assert.throws(() => parseSecurityAnswers('[]'), /JSON object/);
    assert.throws(() => parseSecurityAnswers('{}'), /at least one/);
    assert.throws(
        () => parseSecurityAnswers('{"Question":""}'),
        /non-empty question and string answer/,
    );
});
