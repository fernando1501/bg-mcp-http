/**
 * Warm-instance session storage.
 *
 * Vercel Functions have no durable local filesystem. A live Banco General
 * session is therefore cached only in memory and recreated from server-side
 * environment credentials whenever a new function instance starts or the bank
 * expires its cookies.
 */

export interface StoredCookie {
    name: string;
    value: string;
    domain: string;
    path: string;
    expires: number;
    httpOnly: boolean;
    secure: boolean;
    sameSite: string;
}

export interface StorageState {
    cookies: StoredCookie[];
    origins: unknown[];
}

export interface SessionRecord {
    username: string;
    loggedInAt: number;
    lastVerifiedAt: number;
    storageState: StorageState;
}

let activeSession: SessionRecord | null = null;

export function saveSession(record: SessionRecord): void {
    activeSession = structuredClone(record);
}

export function loadSession(): SessionRecord | null {
    return activeSession ? structuredClone(activeSession) : null;
}

export function clearSession(): void {
    activeSession = null;
}

export function touchSession(): void {
    if (activeSession) activeSession.lastVerifiedAt = Date.now();
}

export function cookieHeader(state: StorageState): string {
    return state.cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
}

export function looksAuthenticated(session: SessionRecord | null): session is SessionRecord {
    if (!session) return false;
    const nowSeconds = Date.now() / 1000;
    return session.storageState.cookies.some(
        (cookie) =>
            cookie.name.toUpperCase().includes('SESSION') &&
            (cookie.expires === -1 || cookie.expires > nowSeconds),
    );
}
