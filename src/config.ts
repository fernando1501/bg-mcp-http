/** Banco General's Zona Segura origin. The only bank host this server contacts. */
export const BASE = 'https://zonasegura.bgeneral.com';

/** Panama is UTC-5 year-round. */
export const PANAMA_OFFSET_HOURS = 5;

/** Browser-shaped requests are more reliable with Banco General's WAF. */
export const USER_AGENT =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';

export const HTTP_TIMEOUT_MS = 30_000;

export interface BankCredentials {
    username: string;
    password: string;
    securityAnswers: Record<string, string>;
    legacySecurityAnswer?: string;
}

function required(name: string): string {
    const value = process.env[name]?.trim();
    if (!value) throw new Error(`Missing required environment variable: ${name}`);
    return value;
}

export function getBankCredentials(): BankCredentials {
    const answersJson = process.env['BG_SECURITY_ANSWERS_JSON']?.trim();
    const legacySecurityAnswer = process.env['BG_SECURITY_ANSWER']?.trim();
    if (!answersJson && !legacySecurityAnswer) {
        throw new Error(
            'Missing required environment variable: BG_SECURITY_ANSWERS_JSON',
        );
    }

    return {
        username: required('BG_USERNAME'),
        password: required('BG_PASSWORD'),
        securityAnswers: answersJson ? parseSecurityAnswers(answersJson) : {},
        legacySecurityAnswer,
    };
}

export function parseSecurityAnswers(value: string): Record<string, string> {
    let parsed: unknown;
    try {
        parsed = JSON.parse(value);
    } catch {
        throw new Error('BG_SECURITY_ANSWERS_JSON must be a valid JSON object.');
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('BG_SECURITY_ANSWERS_JSON must be a JSON object of question-answer pairs.');
    }

    const answers: Record<string, string> = {};
    for (const [question, answer] of Object.entries(parsed)) {
        if (typeof answer !== 'string' || !question.trim() || !answer.trim()) {
            throw new Error(
                'Every BG_SECURITY_ANSWERS_JSON entry must have a non-empty question and string answer.',
            );
        }
        const normalizedQuestion = normalizeSecurityQuestion(question);
        if (answers[normalizedQuestion] !== undefined) {
            throw new Error('BG_SECURITY_ANSWERS_JSON contains duplicate normalized questions.');
        }
        answers[normalizedQuestion] = answer;
    }

    if (Object.keys(answers).length === 0) {
        throw new Error('BG_SECURITY_ANSWERS_JSON must contain at least one question-answer pair.');
    }
    return answers;
}

export function normalizeSecurityQuestion(question: string): string {
    return question
        .normalize('NFKC')
        .trim()
        .toLocaleLowerCase('es-PA')
        .replace(/\s+/g, ' ')
        .replace(/[¿?!.]+$/g, '')
        .trim();
}

export function resolveSecurityAnswer(
    question: string,
    credentials: Pick<BankCredentials, 'securityAnswers' | 'legacySecurityAnswer'>,
): string | null {
    return (
        credentials.securityAnswers[normalizeSecurityQuestion(question)] ??
        credentials.legacySecurityAnswer ??
        null
    );
}

export function getBearerToken(): string {
    return required('MCP_BEARER_TOKEN');
}

export function configurationStatus(): Record<string, boolean> {
    return {
        mcpBearerToken: Boolean(process.env['MCP_BEARER_TOKEN']?.trim()),
        bankUsername: Boolean(process.env['BG_USERNAME']?.trim()),
        bankPassword: Boolean(process.env['BG_PASSWORD']?.trim()),
        bankSecurityAnswers: Boolean(
            process.env['BG_SECURITY_ANSWERS_JSON']?.trim() ||
                process.env['BG_SECURITY_ANSWER']?.trim(),
        ),
    };
}
