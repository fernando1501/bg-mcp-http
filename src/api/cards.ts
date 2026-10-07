/**
 * Credit-card state, movements and category totals.
 *
 * Note the month/year semantics: `find` and `state-card` take a 1-based month,
 * and `{ month: 0, year: 0 }` means "current statement period". A statement
 * period is not a calendar month — it starts on the previous cutoff date — so
 * callers that want a calendar month must clamp the results by date.
 */

import { PANAMA_OFFSET_HOURS } from '../config.js';
import { bank, BankApiError } from '../http/client.js';
import { cardReferer } from './accounts.js';
import { natureToType, toLocalDate, type Transaction } from './normalize.js';

export interface RawCardMovement {
    id?: string;
    dateMovement?: number;
    effectiveDate?: number;
    natureMovement?: string;
    amountMovement?: number;
    description?: string;
    _cardLabel?: string;
}

interface CardFindResponse {
    associatedCreditCardMovement?: Array<{
        card?: { idCard?: { maskCardNumber?: string }; nameCard?: string };
        movement?: RawCardMovement[];
    }>;
}

/** Current balance, limit, cutoff and payment dates for a card. */
export async function getCardState(portalId: number): Promise<unknown> {
    return bank.post('/o/api/product-info/credit-card/state', portalId, cardReferer(portalId));
}

/** Statement detail for one period (1-based month; 0/0 = current period). */
export async function getCardStatement(
    portalId: number,
    month: number,
    year: number,
): Promise<unknown> {
    return bank.post(
        '/o/api/product-info/credit-card/state-card',
        { productId: String(portalId), productType: null, month, year },
        cardReferer(portalId),
    );
}

/** Past statement cutoff dates and balances — useful for picking a period. */
export async function getStatementHistory(portalId: number): Promise<unknown> {
    return bank.get(
        `/o/api/product-info/credit-card/credit-card-statement-history/${portalId}`,
        cardReferer(portalId),
    );
}

/** Physical/virtual cards sharing the account. */
export async function getAssociatedCards(portalId: number): Promise<unknown> {
    return bank.get(
        `/o/api/product-info/credit-card/associated-credit-card/${portalId}`,
        cardReferer(portalId),
    );
}

/** BG's own spend-by-category breakdown for a period. */
export async function getCategoryTotals(
    portalId: number,
    month: number,
    year: number,
): Promise<unknown> {
    return bank.post(
        '/o/api/product-info/credit-card/credit-card-categories-totals',
        { productId: String(portalId), posNumber: -1, id: null, month, year },
        cardReferer(portalId),
    );
}

export async function getCategoryCatalog(portalId: number): Promise<unknown> {
    return bank.post(
        '/o/api/product-info/credit-card/get-categories-catalog',
        {},
        cardReferer(portalId),
    );
}

/**
 * Movements for a statement period, flattened across sub-cards (each
 * cardholder gets their own `movement[]` array).
 */
export async function getCardMovements(
    portalId: number,
    month: number,
    year: number,
): Promise<RawCardMovement[]> {
    try {
        return await fetchCardMovements(portalId, month, year);
    } catch (error) {
        // Agents naturally translate "October 4" to month=10/year=2026, but BG
        // rejects the current, not-yet-closed cutoff with its internal WS 412.
        // Treat that specific current-month request as the open 0/0 period.
        if (
            month !== 0 &&
            year !== 0 &&
            isCurrentPanamaMonth(month, year) &&
            isUnavailableStatementError(error)
        ) {
            return fetchCardMovements(portalId, 0, 0);
        }
        throw error;
    }
}

/**
 * Movements for a calendar date range. The open 0/0 statement is always read,
 * then the possibly-overlapping closed cutoff periods are merged and deduped.
 */
export async function getCardMovementsForDateRange(
    portalId: number,
    fromDate: string,
    toDate: string,
): Promise<RawCardMovement[]> {
    const all: RawCardMovement[] = [];
    let successfulRequests = 0;
    let openPeriodError: unknown;

    for (const { month, year } of cardStatementPeriodsForDateRange(fromDate, toDate)) {
        try {
            all.push(...(await fetchCardMovements(portalId, month, year)));
            successfulRequests += 1;
        } catch (error) {
            if (month === 0 && year === 0) {
                openPeriodError = error;
                continue;
            }
            // The current/future cutoff may not exist yet. That is expected as
            // long as another period (normally 0/0) answered successfully.
            if (isCurrentOrFuturePanamaMonth(month, year) && isUnavailableStatementError(error)) {
                continue;
            }
            throw error;
        }
    }

    if (successfulRequests === 0 && openPeriodError) throw openPeriodError;
    return dedupeRawCardMovements(all);
}

export function cardStatementPeriodsForDateRange(
    fromDate: string,
    toDate: string,
): Array<{ month: number; year: number }> {
    const periods = [{ month: 0, year: 0 }];
    const [fromYear = 1970, fromMonth = 1] = fromDate.split('-').map(Number);
    const [toYear = fromYear, toMonth = fromMonth] = toDate.split('-').map(Number);
    let year = fromYear;
    let month = fromMonth;
    const finalIndex = toYear * 12 + toMonth + 1;

    // A calendar date can belong to a statement whose cutoff is in the same or
    // following month, so include one cutoff month beyond the requested range.
    while (year * 12 + month <= finalIndex && periods.length <= 25) {
        periods.push({ month, year });
        month += 1;
        if (month > 12) {
            month = 1;
            year += 1;
        }
    }
    return periods;
}

export function isCurrentPanamaMonth(month: number, year: number, now = Date.now()): boolean {
    const panamaNow = new Date(now - PANAMA_OFFSET_HOURS * 3_600_000);
    return month === panamaNow.getUTCMonth() + 1 && year === panamaNow.getUTCFullYear();
}

function isCurrentOrFuturePanamaMonth(month: number, year: number): boolean {
    const panamaNow = new Date(Date.now() - PANAMA_OFFSET_HOURS * 3_600_000);
    const currentIndex = panamaNow.getUTCFullYear() * 12 + panamaNow.getUTCMonth() + 1;
    return year * 12 + month >= currentIndex;
}

function isUnavailableStatementError(error: unknown): boolean {
    if (!(error instanceof BankApiError) || error.status !== 400) return false;
    const body = error.body as Record<string, unknown> | null;
    return String(body?.['id'] ?? '') === '412' || Number(body?.['statusCode']) === 412;
}

async function fetchCardMovements(
    portalId: number,
    month: number,
    year: number,
): Promise<RawCardMovement[]> {
    const res = await bank.post<CardFindResponse>(
        '/o/api/product-info/credit-card/find',
        { productId: String(portalId), month, year },
        cardReferer(portalId),
    );
    const all: RawCardMovement[] = [];
    for (const group of res?.associatedCreditCardMovement ?? []) {
        const label = group?.card?.idCard?.maskCardNumber ?? group?.card?.nameCard ?? '';
        for (const m of group?.movement ?? []) {
            all.push({ ...m, _cardLabel: label });
        }
    }
    return all;
}

function dedupeRawCardMovements(movements: RawCardMovement[]): RawCardMovement[] {
    const seen = new Set<string>();
    return movements.filter((movement) => {
        const key = [
            movement.id,
            movement.dateMovement ?? movement.effectiveDate,
            movement.amountMovement,
            movement.natureMovement,
            movement.description,
            movement._cardLabel,
        ].join('#');
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

export function normalizeCardMovements(
    movements: RawCardMovement[],
    account: { portalId: number; alias: string; maskedNumber: string },
): Transaction[] {
    return movements.map((m) => {
        const timestamp = m.dateMovement ?? m.effectiveDate ?? 0;
        return {
            id: String(m.id ?? ''),
            date: toLocalDate(timestamp),
            timestamp,
            account: m._cardLabel ? `${account.alias} ${m._cardLabel}` : account.alias,
            accountPortalId: account.portalId,
            description: (m.description ?? '').trim(),
            amount: m.amountMovement ?? 0,
            nature: m.natureMovement ?? '',
            // On a card, 'D' is a charge and 'C' is a payment toward the balance.
            type: natureToType(m.natureMovement),
            balanceAfter: null,
            source: 'credit-card' as const,
        };
    });
}
