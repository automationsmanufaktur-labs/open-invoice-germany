import { describe, it, expect } from "vitest";
import { effectiveInvoiceStatus, isPartiallyPaid, INVOICE_STATUS_LABEL } from "@/domain/invoice/status";

// Fix-Welle Phase 8b (S7): utcDateOnly() vergleicht Kalendertage in UTC, nicht in lokaler
// Zeit — Fixdaten deshalb ueber Date.UTC(...) konstruiert (feste UTC-Daten), statt ueber
// die lokale `new Date(year, month, day, ...)`-Form, deren tatsaechlicher UTC-Kalendertag
// von der Test-Timezone abhaengen wuerde (Europe/Berlin liegt vor Mitternacht bereits auf
// dem naechsten UTC-Tag).
const NOW = new Date(Date.UTC(2063, 5, 15, 10, 0, 0));
const YESTERDAY = new Date(Date.UTC(2063, 5, 14));
const TODAY = new Date(Date.UTC(2063, 5, 15));
const TOMORROW = new Date(Date.UTC(2063, 5, 16));
const ISSUE = new Date(Date.UTC(2063, 5, 1));

describe("effectiveInvoiceStatus", () => {
  it("DRAFT bleibt DRAFT unabhaengig von dueDate", () => {
    expect(effectiveInvoiceStatus({ status: "DRAFT", dueDate: YESTERDAY, issueDate: ISSUE }, NOW)).toBe("DRAFT");
    expect(effectiveInvoiceStatus({ status: "DRAFT", dueDate: null, issueDate: ISSUE }, NOW)).toBe("DRAFT");
  });

  it("PAID bleibt PAID unabhaengig von dueDate", () => {
    expect(effectiveInvoiceStatus({ status: "PAID", dueDate: YESTERDAY, issueDate: ISSUE }, NOW)).toBe("PAID");
  });

  // Fix-Welle (S1, Ruling): PARTIALLY_PAID faellt jetzt in den dueDate-Zweig (OPEN/DUE/
  // OVERDUE) statt unveraendert durchgereicht zu werden — vorher verschwand eine
  // teilbezahlte ueberfaellige Rechnung aus jeder faellig/ueberfaellig-Ableitung
  // (Kundenuebersicht, Dashboard-Aging, Listenfilter "overdue", Mahn-Aktionsmatrix).
  it("PARTIALLY_PAID faellt in den dueDate-Zweig (OPEN/DUE/OVERDUE), isPartiallyPaid bleibt true", () => {
    expect(effectiveInvoiceStatus({ status: "PARTIALLY_PAID", dueDate: YESTERDAY, issueDate: ISSUE }, NOW)).toBe("OVERDUE");
    expect(effectiveInvoiceStatus({ status: "PARTIALLY_PAID", dueDate: TODAY, issueDate: ISSUE }, NOW)).toBe("DUE");
    expect(effectiveInvoiceStatus({ status: "PARTIALLY_PAID", dueDate: TOMORROW, issueDate: ISSUE }, NOW)).toBe("OPEN");
    expect(effectiveInvoiceStatus({ status: "PARTIALLY_PAID", dueDate: null, issueDate: ISSUE }, NOW)).toBe("OPEN");
    expect(isPartiallyPaid("PARTIALLY_PAID")).toBe(true);
    expect(isPartiallyPaid("FINALIZED")).toBe(false);
  });

  it("CANCELLED bleibt CANCELLED unabhaengig von dueDate", () => {
    expect(effectiveInvoiceStatus({ status: "CANCELLED", dueDate: YESTERDAY, issueDate: ISSUE }, NOW)).toBe("CANCELLED");
  });

  it("FINALIZED ohne dueDate ist OPEN", () => {
    expect(effectiveInvoiceStatus({ status: "FINALIZED", dueDate: null, issueDate: ISSUE }, NOW)).toBe("OPEN");
  });

  it("SENT ohne dueDate ist OPEN", () => {
    expect(effectiveInvoiceStatus({ status: "SENT", dueDate: null, issueDate: ISSUE }, NOW)).toBe("OPEN");
  });

  it("FINALIZED mit dueDate gestern ist OVERDUE", () => {
    expect(effectiveInvoiceStatus({ status: "FINALIZED", dueDate: YESTERDAY, issueDate: ISSUE }, NOW)).toBe("OVERDUE");
  });

  it("FINALIZED mit dueDate heute ist DUE", () => {
    expect(effectiveInvoiceStatus({ status: "FINALIZED", dueDate: TODAY, issueDate: ISSUE }, NOW)).toBe("DUE");
  });

  it("FINALIZED mit dueDate morgen ist OPEN", () => {
    expect(effectiveInvoiceStatus({ status: "FINALIZED", dueDate: TOMORROW, issueDate: ISSUE }, NOW)).toBe("OPEN");
  });

  it("SENT mit dueDate gestern ist OVERDUE", () => {
    expect(effectiveInvoiceStatus({ status: "SENT", dueDate: YESTERDAY, issueDate: ISSUE }, NOW)).toBe("OVERDUE");
  });

  it("SENT mit dueDate heute ist DUE", () => {
    expect(effectiveInvoiceStatus({ status: "SENT", dueDate: TODAY, issueDate: ISSUE }, NOW)).toBe("DUE");
  });

  it("SENT mit dueDate morgen ist OPEN", () => {
    expect(effectiveInvoiceStatus({ status: "SENT", dueDate: TOMORROW, issueDate: ISSUE }, NOW)).toBe("OPEN");
  });

  it("dueDate exakt an der UTC-Mitternachtsgrenze zaehlt tagesgenau, nicht per Uhrzeit", () => {
    const dueLateToday = new Date(Date.UTC(2063, 5, 15, 23, 59, 0));
    expect(effectiveInvoiceStatus({ status: "FINALIZED", dueDate: dueLateToday, issueDate: ISSUE }, NOW)).toBe("DUE");
  });

  it("INVOICE_STATUS_LABEL deckt alle acht Zustaende ab", () => {
    const keys: Array<keyof typeof INVOICE_STATUS_LABEL> = [
      "DRAFT", "FINALIZED", "OPEN", "DUE", "OVERDUE", "PARTIALLY_PAID", "PAID", "CANCELLED",
    ];
    for (const k of keys) {
      expect(typeof INVOICE_STATUS_LABEL[k]).toBe("string");
      expect(INVOICE_STATUS_LABEL[k].length).toBeGreaterThan(0);
    }
  });
});
