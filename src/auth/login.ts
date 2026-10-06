/** Automatic Banco General login using credentials that exist only on the server. */

import serverlessChromium from '@sparticuz/chromium';
import {
    chromium,
    type Browser,
    type BrowserContext,
    type Locator,
    type Page,
} from 'playwright-core';

import { BASE, getBankCredentials } from '../config.js';
import { loadSession, looksAuthenticated, saveSession, type StorageState } from './session.js';

export class LoginError extends Error {
    readonly code: string;

    constructor(code: string, message: string) {
        super(message);
        this.name = 'LoginError';
        this.code = code;
    }
}

let loginInFlight: Promise<void> | null = null;

export async function ensureBankSession(): Promise<void> {
    if (looksAuthenticated(loadSession())) return;
    loginInFlight ??= loginFromEnvironment().finally(() => {
        loginInFlight = null;
    });
    await loginInFlight;
}

async function loginFromEnvironment(): Promise<void> {
    const credentials = getBankCredentials();
    let browser: Browser | null = null;
    let context: BrowserContext | null = null;
    let page: Page | null = null;

    try {
        const executablePath =
            process.env['BG_CHROMIUM_EXECUTABLE_PATH']?.trim() ||
            (process.env['VERCEL'] ? await serverlessChromium.executablePath() : chromium.executablePath());

        browser = await chromium.launch({
            headless: true,
            executablePath,
            args: process.env['VERCEL'] ? serverlessChromium.args : undefined,
        });
        context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
        page = await context.newPage();

        let lastApiResponse: Record<string, unknown> | null = null;
        context.on('response', (response) => {
            const url = response.url();
            if (!/api\/jsonws\/invoke/.test(url) && !/login/i.test(url)) return;
            void (async () => {
                try {
                    const contentType = response.headers()['content-type'] ?? '';
                    if (/json/i.test(contentType)) {
                        lastApiResponse = (await response.json()) as Record<string, unknown>;
                    }
                } catch {
                    // Ignore non-JSON and already-consumed responses.
                }
            })();
        });

        await page.goto(`${BASE}/web/guest/home#!/login/username`, {
            waitUntil: 'domcontentloaded',
            timeout: 30_000,
        });
        await requireUrl(page, [/login\/username/], 15_000, 'LOGIN_PAGE_NOT_REACHED');

        const usernameInput = await waitForLoginInput(page, 'text', 15_000);
        await usernameInput.fill(credentials.username);
        await submitCurrentForm(page);

        await requireUrl(
            page,
            [/login\/security_question/, /login\/password/],
            20_000,
            'SECURITY_QUESTION_NOT_REACHED',
        );
        const question = await pollFor(
            () => lastApiResponse?.['securityQuestion'] as string | undefined,
            5_000,
        );
        if (!question) {
            throw new LoginError(
                'NO_SECURITY_QUESTION',
                'Banco General did not return the security question.',
            );
        }

        const answerInput = await waitForLoginInput(page, 'text', 10_000);
        await answerInput.fill(credentials.securityAnswer);
        await submitCurrentForm(page);

        await requireUrl(page, [/login\/password/], 20_000, 'PASSWORD_SCREEN_NOT_REACHED');
        const passwordInput = await waitForLoginInput(page, 'password', 10_000);
        await passwordInput.fill(credentials.password);
        await submitCurrentForm(page);

        const settled = await waitForUrl(page, [/dashboard/, /otp|token|codigo|c[oó]digo/i], 30_000);
        if (settled?.index === 1) {
            throw new LoginError(
                'OTP_REQUIRED',
                'Banco General requested a one-time code. Refresh the trusted-device session before using the remote server.',
            );
        }
        if (!settled) {
            throw new LoginError(
                'DASHBOARD_NOT_REACHED',
                `Banco General did not reach the dashboard after login (at ${page.url()}).`,
            );
        }

        const hasSessionCookie = await pollFor(async () => {
            const cookies = await context!.cookies();
            return cookies.some((cookie) => cookie.name.toUpperCase().includes('SESSION')) || undefined;
        }, 10_000);
        if (!hasSessionCookie) {
            throw new LoginError('NO_SESSION_COOKIE', 'Banco General did not issue a session cookie.');
        }

        const storageState = (await context.storageState()) as unknown as StorageState;
        const now = Date.now();
        saveSession({
            username: credentials.username,
            loggedInAt: now,
            lastVerifiedAt: now,
            storageState,
        });
    } catch (error) {
        if (error instanceof LoginError) throw error;
        throw new LoginError(
            'AUTOMATIC_LOGIN_FAILED',
            `${error instanceof Error ? error.message : String(error)}${page ? ` (at ${page.url()})` : ''}`,
        );
    } finally {
        await browser?.close().catch(() => undefined);
    }
}

async function waitForLoginInput(
    page: Page,
    kind: 'text' | 'password',
    timeoutMs: number,
): Promise<Locator> {
    const selector =
        kind === 'password'
            ? 'input[type="password"]'
            : 'input:not([type="password"]):not([type="hidden"]):not([type="checkbox"]):not([type="submit"]):not([type="button"])';
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const candidates = page.locator(selector);
        for (let index = 0; index < (await candidates.count()); index += 1) {
            const element = candidates.nth(index);
            if ((await element.isVisible()) && (await element.isEditable())) return element;
        }
        await page.waitForTimeout(250);
    }
    throw new LoginError('INPUT_NOT_FOUND', `Timed out waiting for the ${kind} input.`);
}

async function submitCurrentForm(page: Page): Promise<void> {
    const button = page
        .locator(
            'button[type="submit"]:visible, button:has-text("Continuar"):visible, button:has-text("Entrar"):visible, button:has-text("Iniciar"):visible',
        )
        .first();
    if ((await button.count()) > 0 && (await button.isVisible())) await button.click();
    else await page.keyboard.press('Enter');
}

async function pollFor<T>(
    thunk: () => T | undefined | Promise<T | undefined>,
    timeoutMs: number,
): Promise<T | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const value = await thunk();
        if (value) return value;
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return null;
}

async function requireUrl(
    page: Page,
    patterns: RegExp[],
    timeoutMs: number,
    code: string,
): Promise<void> {
    if (!(await waitForUrl(page, patterns, timeoutMs))) {
        throw new LoginError(code, `Banco General did not advance to the expected screen (at ${page.url()}).`);
    }
}

async function waitForUrl(
    page: Page,
    patterns: RegExp[],
    timeoutMs: number,
): Promise<{ index: number; url: string } | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const url = page.url();
        const index = patterns.findIndex((pattern) => pattern.test(url));
        if (index !== -1) return { index, url };
        await new Promise((resolve) => setTimeout(resolve, 200));
    }
    return null;
}
