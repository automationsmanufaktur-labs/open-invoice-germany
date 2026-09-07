/**
 * Phase 8b Fix-Runde 1 (Ruling c) — Prioritaetskette der Zahlungsart-Vorbelegung in der
 * Rechnungsliste (RowActionsMenu PAYMENT): Kunden-Standard -> Org-Standard -> erste
 * aktive Methode -> "TRANSFER".
 */
import { describe, it, expect } from "vitest";
import { resolveDefaultPaymentMethodCode } from "@/domain/payment-method/default";

describe("resolveDefaultPaymentMethodCode", () => {
  it("bevorzugt den Kunden-Standard vor allem anderen", () => {
    expect(
      resolveDefaultPaymentMethodCode({
        customerDefaultCode: "SEPA",
        orgDefaultCode: "TRANSFER",
        activeMethods: [{ code: "CASH" }],
      }),
    ).toBe("SEPA");
  });

  it("faellt ohne Kunden-Standard auf den Org-Standard zurueck", () => {
    expect(
      resolveDefaultPaymentMethodCode({
        customerDefaultCode: null,
        orgDefaultCode: "TRANSFER",
        activeMethods: [{ code: "CASH" }],
      }),
    ).toBe("TRANSFER");
  });

  it("faellt ohne Kunden- und Org-Standard auf die erste aktive Methode zurueck", () => {
    expect(
      resolveDefaultPaymentMethodCode({
        customerDefaultCode: undefined,
        orgDefaultCode: undefined,
        activeMethods: [{ code: "CASH" }, { code: "SEPA" }],
      }),
    ).toBe("CASH");
  });

  it("faellt ohne jede Vorgabe auf TRANSFER zurueck (Schema-Default)", () => {
    expect(resolveDefaultPaymentMethodCode({ activeMethods: [] })).toBe("TRANSFER");
  });

  it("ignoriert einen leeren String als Kunden-Standard (kein falsy-Bypass auf Org-Standard verhindern)", () => {
    expect(
      resolveDefaultPaymentMethodCode({
        customerDefaultCode: "",
        orgDefaultCode: "TRANSFER",
        activeMethods: [],
      }),
    ).toBe("TRANSFER");
  });
});
