/**
 * Phase 10, Task 2 (task-2-facts.md, erster Punkt): Tabellen-Test fuer die explizite
 * Domain-Fehler-Registry in src/api/errors.ts — jede gelistete Klasse muss auf 409
 * CONFLICT gemappt werden (Registry-Klassen ohne eigene `status`-Eigenschaft), waehrend
 * DunningStageError/DunningStageNotFoundError/DunningStageInUseError weiterhin per
 * Duck-Typing (400/404/409, je nach Unterklasse) gemappt werden. DeliveryNoteValidationError
 * ist die dokumentierte Ausnahme: obwohl sie DeliveryNoteError erweitert, bleibt sie 400.
 */
import { describe, it, expect } from "vitest";
import { mapApiError } from "@/api/errors";
import { ConvertError } from "@/domain/document/convert";
import { PaymentError } from "@/domain/invoice/payment";
import { CreditError } from "@/domain/invoice/credit";
import { FinalizeError } from "@/domain/invoice/finalize";
import { CancelError } from "@/domain/invoice/cancel";
import { DunningError } from "@/domain/dunning/create";
import { DunningStageError, DunningStageNotFoundError, DunningStageInUseError } from "@/domain/dunning/stages";
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

describe("mapApiError — explizite Domain-Fehler-Registry (task-2-facts.md)", () => {
  const conflictCases: [string, Error][] = [
    ["ConvertError", new ConvertError("x")],
    ["PaymentError", new PaymentError("x")],
    ["CreditError", new CreditError("x")],
    ["FinalizeError", new FinalizeError("x")],
    ["CancelError", new CancelError("x")],
    ["DunningError", new DunningError("x")],
    ["PartialInvoiceError", new PartialInvoiceError("x")],
    ["DownpaymentInvoiceError", new DownpaymentInvoiceError("x")],
    ["FinalInvoiceError", new FinalInvoiceError("x")],
    ["StatusTransitionError", new StatusTransitionError("x")],
    ["ShareLinkError", new ShareLinkError("x")],
    ["InvoiceUpdateError", new InvoiceUpdateError("x")],
    ["DeliveryNoteError", new DeliveryNoteError("x")],
    ["RecurringError", new RecurringError("x")],
    ["AttachmentValidationError", new AttachmentValidationError("x")],
    ["PricingError", new PricingError("x")],
    ["MailNotConfiguredError", new MailNotConfiguredError()],
  ];

  it.each(conflictCases)("%s -> 409 CONFLICT mit Domain-Text", (_name, err) => {
    const { status, body } = mapApiError(err);
    expect(status).toBe(409);
    expect(body.error.code).toBe("CONFLICT");
    expect(body.error.message).toBe(err.message);
  });

  it("DeliveryNoteValidationError (erweitert DeliveryNoteError) -> 400 VALIDATION, NICHT 409", () => {
    const { status, body } = mapApiError(new DeliveryNoteValidationError("ungueltig"));
    expect(status).toBe(400);
    expect(body.error.code).toBe("VALIDATION");
  });

  it("DunningStageError (Basisklasse, direkt geworfen) -> Duck-Typing status=400", () => {
    const { status, body } = mapApiError(new DunningStageError("x"));
    expect(status).toBe(400);
    expect(body.error.code).toBe("VALIDATION");
  });

  it("DunningStageNotFoundError -> Duck-Typing 404, NICHT von der Registry auf 409 ueberschrieben", () => {
    const { status, body } = mapApiError(new DunningStageNotFoundError());
    expect(status).toBe(404);
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("DunningStageInUseError -> Duck-Typing 409 (bereits korrekt, unabhaengig von der Registry)", () => {
    const { status } = mapApiError(new DunningStageInUseError());
    expect(status).toBe(409);
  });

  it("unbekannter Fehler ohne Registry-Eintrag -> 500 INTERNAL (Fallback bleibt bestehen)", () => {
    const { status, body } = mapApiError(new Error("irgendwas"));
    expect(status).toBe(500);
    expect(body.error.code).toBe("INTERNAL");
  });
});
