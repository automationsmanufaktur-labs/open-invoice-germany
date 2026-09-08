/**
 * Antwort-Umschlag fuer /api/v1/* (Phase 10, Task 1, plan §"Antwortformat"):
 * Einzelobjekt `{ data }`, Liste `{ data, total, limit, offset }`. Wird von jeder
 * Ressourcenroute (Tasks 2-5) genutzt — keine Route baut ihre eigene Huelle.
 */
import { NextResponse } from "next/server";

export function apiData<T>(data: T, status = 200): NextResponse {
  return NextResponse.json({ data }, { status });
}

export interface PaginationParams {
  limit: number;
  offset: number;
}

export interface ListOptions extends PaginationParams {
  total: number;
}

export function apiList<T>(items: T[], opts: ListOptions, status = 200): NextResponse {
  return NextResponse.json({ data: items, total: opts.total, limit: opts.limit, offset: opts.offset }, { status });
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/** Liest `limit`/`offset` aus den Query-Parametern — begrenzt, nie negativ. */
export function parsePagination(searchParams: URLSearchParams): PaginationParams {
  const rawLimit = Number(searchParams.get("limit"));
  const rawOffset = Number(searchParams.get("offset"));
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.trunc(rawLimit), MAX_LIMIT) : DEFAULT_LIMIT;
  const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? Math.trunc(rawOffset) : 0;
  return { limit, offset };
}
