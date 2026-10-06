/** Shared tool-result and error plumbing. */

import { LoginError } from '../auth/login.js';
import { BankApiError, SessionExpiredError } from '../http/client.js';

export interface ToolResult {
    [key: string]: unknown;
    content: Array<{ type: 'text'; text: string }>;
    isError?: boolean;
}

export function jsonResult(data: unknown): ToolResult {
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

export function errorResult(message: string, code?: string): ToolResult {
    return {
        content: [{ type: 'text', text: JSON.stringify({ error: message, code }, null, 2) }],
        isError: true,
    };
}

export function guarded<A>(handler: (args: A) => Promise<ToolResult>) {
    return async (args: A): Promise<ToolResult> => {
        try {
            return await handler(args);
        } catch (error) {
            if (error instanceof LoginError) return errorResult(error.message, error.code);
            if (error instanceof SessionExpiredError) return errorResult(error.message, error.code);
            if (error instanceof BankApiError) return errorResult(error.message, `BANK_${error.status}`);
            return errorResult(error instanceof Error ? error.message : String(error));
        }
    };
}

export function limited<T>(items: T[], limit?: number): { items: T[]; truncated: boolean; total: number } {
    if (limit === undefined || items.length <= limit) {
        return { items, truncated: false, total: items.length };
    }
    return { items: items.slice(0, limit), truncated: true, total: items.length };
}
