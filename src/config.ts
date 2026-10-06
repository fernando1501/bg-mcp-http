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
    securityAnswer: string;
}

function required(name: string): string {
    const value = process.env[name]?.trim();
    if (!value) throw new Error(`Missing required environment variable: ${name}`);
    return value;
}

export function getBankCredentials(): BankCredentials {
    return {
        username: required('BG_USERNAME'),
        password: required('BG_PASSWORD'),
        securityAnswer: required('BG_SECURITY_ANSWER'),
    };
}

export function getBearerToken(): string {
    return required('MCP_BEARER_TOKEN');
}

export function configurationStatus(): Record<string, boolean> {
    return {
        mcpBearerToken: Boolean(process.env['MCP_BEARER_TOKEN']?.trim()),
        bankUsername: Boolean(process.env['BG_USERNAME']?.trim()),
        bankPassword: Boolean(process.env['BG_PASSWORD']?.trim()),
        bankSecurityAnswer: Boolean(process.env['BG_SECURITY_ANSWER']?.trim()),
    };
}
