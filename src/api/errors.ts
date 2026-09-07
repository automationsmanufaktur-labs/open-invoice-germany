/**
 * Fehler-Mapping fuer /api/v1/* (Phase 10, Task 1, task-1-facts.md "Fehlerformat").
 * Einheitliches Format: `{ error: { code, message, details? } }`.
 *
 * Task 2 (task-2-facts.md, erster Punkt): explizite Registry der Domain-Fehlerklassen
 * OHNE eigene `status`-Eigenschaft → 409 CONFLICT mit dem Domain-Text. Klassen MIT
 * `status` (z. B. DunningStageError/DunningStageNotFoundError/DunningStageInUseError)
 * werden weiterhin ausschliesslich per Duck-Typing (weiter unten) behandelt — die
 * Duck-Typing-Pruefung laeuft VOR der Registry, damit z. B. DunningStageNotFoundError
 * (status 404) nicht durch die Registry auf 409 ueberschrieben wird.
 */
import { z } from "zod";
import { NextResponse } from "next/server";
import { NotFoundError, InvalidOperationError, EInvoiceInvalidError } from "@/domain/errors";
import { ApiAuthError, ApiScopeError } from "@/domain/api-key/verify";
import { RateLimitError } from "@/lib/rate-limit";
import { IdempotencyConflictError, IdempotencyInProgressError } from "./idempotency";
import { ConvertError } from "@/domain/document/convert";
import { PaymentError } from "@/domain/invoice/payment";
import { CreditError } from "@/domain/invoice/credit";
import { FinalizeError } from "@/domain/invoice/finalize";
import { CancelError } from "@/domain/invoice/cancel";
import { DunningError } from "@/domain/dunning/create";
import { PartialInvoiceError } from "@/domain/invoice/partial";
import { DownpaymentInvoiceError } from "@/domain/invoice/downpayment";
import { FinalInvoiceError } from "@/domain/invoice/final";
import { StatusTransitionError } from "@/domain/document/status";
import { ShareLinkError } from "@/domain/quote-share/link";
import { InvoiceUpdateError } from "@/domain/invoice/update";
import { DeliveryNoteError, DeliveryNoteValidationError } from "@/domain/delivery-note/create";
import { RecurringError } from "@/domain/recurring/create";
import { AttachmentValidationError } from "@/lib/attachments/storage";
import { PricingError } from "@/lib/pricing/errors";
import { MailNotConfiguredError } from "@/domain/email/settings";

/**
 * Domain-Fehlerklassen (task-2-facts.md), die OHNE eigene `status`-Eigenschaft daherkommen
 * und daher deterministisch auf 409 CONFLICT gemappt werden — DunningStageError ist
 * absichtlich NICHT hier gelistet (hat `status` selbst, siehe Duck-Typing oben im Kommentar).
 */
const DOMAIN_CONFLICT_ERROR_CLASSES = [
  ConvertError,
  PaymentError,
  CreditError,
  FinalizeError,
  CancelError,
  DunningError,
  PartialInvoiceError,
  DownpaymentInvoiceError,
  FinalInvoiceError,
  StatusTransitionError,
  ShareLinkError,
  InvoiceUpdateError,
  DeliveryNoteError,
  RecurringError,
  AttachmentValidationError,
  PricingError,
  MailNotConfiguredError,
] as const;

/**
 * Fix-Welle (Should-fix 5): kein Request-Body-Limit bedeutete, dass ein einzelner
 * (z. B. 500 MB grosser) JSON-Body den Container-Prozess per OOM abschiessen konnte —
 * `req.text()` liest den kompletten Body in den Speicher, ohne jede Groessenpruefung
 * vorher. `withApi` (src/api/auth.ts) wirft diesen Fehler, wenn `Content-Length` das
 * Limit ueberschreitet ODER (falls der Header fehlt/falsch ist) der tatsaechlich
 * gelesene Body laenger ist.
 */
export class PayloadTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PayloadTooLargeError";
  }
}

export type ApiErrorCode =
  | "VALIDATION"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "PAYLOAD_TOO_LARGE"
  | "RATE_LIMITED"
  | "IDEMPOTENCY_MISMATCH"
  | "IDEMPOTENCY_IN_PROGRESS"
  | "EINVOICE_INVALID"
  | "INTERNAL";

export interface ApiErrorBody {
  error: { code: ApiErrorCode; message: string; details?: unknown };
}

function statusToCode(status: number): ApiErrorCode | null {
  switch (status) {
    case 400:
      return "VALIDATION";
    case 401:
      return "UNAUTHORIZED";
    case 403:
      return "FORBIDDEN";
    case 404:
      return "NOT_FOUND";
    case 409:
      return "CONFLICT";
    case 429:
      return "RATE_LIMITED";
    default:
      return null;
  }
}

/** Maps a caught error to an HTTP status + einheitlichen Fehlerkoerper. */
export function mapApiError(e: unknown): { status: number; body: ApiErrorBody } {
  if (e instanceof z.ZodError) {
    return { status: 400, body: { error: { code: "VALIDATION", message: "Validierung fehlgeschlagen.", details: { issues: e.issues } } } };
  }
  if (e instanceof ApiAuthError) {
    return { status: 401, body: { error: { code: "UNAUTHORIZED", message: e.message } } };
  }
  if (e instanceof ApiScopeError) {
    return { status: 403, body: { error: { code: "FORBIDDEN", message: e.message } } };
  }
  if (e instanceof IdempotencyConflictError) {
    return { status: 409, body: { error: { code: "IDEMPOTENCY_MISMATCH", message: e.message } } };
  }
  if (e instanceof IdempotencyInProgressError) {
    return { status: 409, body: { error: { code: "IDEMPOTENCY_IN_PROGRESS", message: e.message } } };
  }
  if (e instanceof PayloadTooLargeError) {
    return { status: 413, body: { error: { code: "PAYLOAD_TOO_LARGE", message: e.message } } };
  }
  // Fix-Runde 1 (Koordinator-Ruling c, Task 3): muss VOR dem generischen NotFoundError-
  // Zweig stehen (unabhaengige Klasse, keine Ueberschneidung, aber Reihenfolge analog den
  // uebrigen spezifischen Vorab-Pruefungen in dieser Funktion).
  if (e instanceof EInvoiceInvalidError) {
    return { status: 409, body: { error: { code: "EINVOICE_INVALID", message: e.message, details: { issues: e.issues } } } };
  }
  if (e instanceof NotFoundError) {
    return { status: 404, body: { error: { code: "NOT_FOUND", message: e.message } } };
  }
  if (e instanceof InvalidOperationError) {
    return { status: 409, body: { error: { code: "CONFLICT", message: e.message } } };
  }
  if (e instanceof RateLimitError) {
    return { status: 429, body: { error: { code: "RATE_LIMITED", message: e.message } } };
  }
  // Duck-Typing fuer bestehende Domain-Fehlerklassen mit `status` (z. B. DunningStageError/
  // DunningStageNotFoundError/DunningStageInUseError — 400/404/409 je nach Unterklasse).
  if (e instanceof Error && "status" in e && typeof (e as { status: unknown }).status === "number") {
    const status = (e as { status: number }).status;
    const code = statusToCode(status);
    if (code && status < 500) {
      return { status, body: { error: { code, message: e.message } } };
    }
  }
  // DeliveryNoteValidationError extends DeliveryNoteError (siehe deren Modulkommentar:
  // "waehrend die generische DeliveryNoteError bei 409 bleibt") — MUSS vor dem generischen
  // DeliveryNoteError-Eintrag der Registry geprueft werden, sonst wuerde `instanceof
  // DeliveryNoteError` faelschlich auch fuer die Validierungs-Unterklasse 409 liefern.
  if (e instanceof DeliveryNoteValidationError) {
    return { status: 400, body: { error: { code: "VALIDATION", message: e.message } } };
  }
  // Task 2, task-2-facts.md (erster Punkt): explizite Registry der Domain-Fehlerklassen
  // OHNE `status` — deterministisch 409 CONFLICT statt 500-Fallback.
  if (e instanceof Error && DOMAIN_CONFLICT_ERROR_CLASSES.some((cls) => e instanceof cls)) {
    return { status: 409, body: { error: { code: "CONFLICT", message: e.message } } };
  }
  console.error("[api] Unerwarteter Fehler:", e instanceof Error ? (e.stack ?? e.message) : e);
  return { status: 500, body: { error: { code: "INTERNAL", message: "Interner Fehler." } } };
}

export function apiError(e: unknown): NextResponse {
  const { status, body } = mapApiError(e);
  const res = NextResponse.json(body, { status });
  if (e instanceof RateLimitError) {
    res.headers.set("Retry-After", String(Math.ceil(e.retryAfterMs / 1000)));
  }
  return res;
}
