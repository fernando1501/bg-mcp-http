/** Authenticated, read-only Banco General HTTP client with automatic server-side login. */

import axios, { type AxiosInstance, type AxiosResponse } from 'axios';

import { clearSession, cookieHeader, loadSession, looksAuthenticated, touchSession, type SessionRecord } from '../auth/session.js';
import { ensureBankSession } from '../auth/login.js';
import { BASE, HTTP_TIMEOUT_MS, USER_AGENT } from '../config.js';
import { assertReadOnly } from './guard.js';

export class SessionExpiredError extends Error {
    readonly code = 'SESSION_EXPIRED';

    constructor(message = 'Banco General rejected the automatically created session.') {
        super(message);
        this.name = 'SessionExpiredError';
    }
}

export class BankApiError extends Error {
    readonly status: number;
    readonly body: unknown;

    constructor(method: string, path: string, status: number, body: unknown) {
        super(`${method} ${path} → ${status}: ${JSON.stringify(body)?.slice(0, 300)}`);
        this.name = 'BankApiError';
        this.status = status;
        this.body = body;
    }
}

function buildAxios(session: SessionRecord): AxiosInstance {
    return axios.create({
        baseURL: BASE,
        timeout: HTTP_TIMEOUT_MS,
        maxRedirects: 0,
        headers: {
            Cookie: cookieHeader(session.storageState),
            Accept: 'application/json, text/plain, */*',
            'Content-Type': 'application/json',
            Origin: BASE,
            Referer: `${BASE}/group/guest/dashboard`,
            'User-Agent': USER_AGENT,
            // Deliberately no CSRF token. Read-only defense in depth.
        },
        validateStatus: () => true,
    });
}

function isSessionExpiredResponse(response: AxiosResponse): boolean {
    const contentType = String(response.headers['content-type'] ?? '');
    if (response.status === 401 || response.status === 403) return true;
    if (response.status >= 300 && response.status < 400) return true;
    return /text\/html/i.test(contentType) && typeof response.data === 'string' && /login/i.test(response.data);
}

export class BankClient {
    private http: AxiosInstance | null = null;

    reload(): void {
        const session = loadSession();
        this.http = looksAuthenticated(session) ? buildAxios(session) : null;
    }

    isAuthenticated(): boolean {
        return looksAuthenticated(loadSession());
    }

    getSession(): SessionRecord | null {
        return loadSession();
    }

    async get<T = unknown>(path: string, referer?: string): Promise<T> {
        assertReadOnly('GET', path);
        return this.request<T>('GET', path, undefined, referer);
    }

    async post<T = unknown>(path: string, body: unknown, referer?: string): Promise<T> {
        assertReadOnly('POST', path);
        return this.request<T>('POST', path, body, referer);
    }

    private async requireClient(): Promise<AxiosInstance> {
        if (!this.http) {
            await ensureBankSession();
            this.reload();
        }
        if (!this.http) throw new SessionExpiredError('Automatic Banco General login did not create a session.');
        return this.http;
    }

    private async request<T>(
        method: 'GET' | 'POST',
        path: string,
        body?: unknown,
        referer?: string,
        retry = true,
    ): Promise<T> {
        const http = await this.requireClient();
        const config = { headers: referer ? { Referer: referer } : undefined };
        const response =
            method === 'GET' ? await http.get(path, config) : await http.post(path, body, config);

        if (isSessionExpiredResponse(response)) {
            clearSession();
            this.http = null;
            if (retry) return this.request<T>(method, path, body, referer, false);
            throw new SessionExpiredError();
        }
        if (response.status >= 400) {
            throw new BankApiError(method, path, response.status, response.data);
        }
        touchSession();
        return response.data as T;
    }

    persistFreshness(): void {
        touchSession();
    }
}

export const bank = new BankClient();
