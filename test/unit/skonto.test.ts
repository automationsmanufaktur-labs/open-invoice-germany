import { describe, it, expect } from "vitest";
import { skontoTerms, detectSkonto, paymentTermsText, xrechnungSkontoNote } from "@/lib/pricing/skonto";
import { formatCents } from "@/lib/money";

const issueDate = new Date(Date.UTC(2034, 5, 3)); // 03.06.2034

describe("skontoTerms", () => {
  it("2 % / 7 Tage auf 1.190,00 € -> Skontobetrag 23,80 €, payable 1.166,20 €", () => {
    const terms = skontoTerms({
      issueDate,
      grossTotalCents: 119000,
      skonto1Permille: 20,
      skonto1Days: 7,
      skonto2Permille: null,
      skonto2Days: null,
    });
    expect(terms).toHaveLength(1);
    expect(terms[0].amountCents).toBe(2380);
    expect(terms[0].payableCents).toBe(116620);
    expect(terms[0].dueDate.toISOString()).toBe(new Date(Date.UTC(2034, 5, 10)).toISOString());
  });

  it("zwei Ziele (2 %/7 Tage, 1 %/14 Tage)", () => {
    const terms = skontoTerms({
      issueDate,
      grossTotalCents: 119000,
      skonto1Permille: 20,
      skonto1Days: 7,
      skonto2Permille: 10,
      skonto2Days: 14,
    });
    expect(terms).toHaveLength(2);
    expect(terms[0].days).toBe(7);
    expect(terms[1].days).toBe(14);
    expect(terms[1].amountCents).toBe(1190);
  });

  it("null-Felder erzeugen keine Frist", () => {
    const terms = skontoTerms({
      issueDate,
      grossTotalCents: 119000,
      skonto1Permille: null,
      skonto1Days: null,
      skonto2Permille: null,
      skonto2Days: null,
    });
    expect(terms).toEqual([]);
  });
});

describe("detectSkonto", () => {
  const terms = skontoTerms({
    issueDate,
    grossTotalCents: 119000,
    skonto1Permille: 20,
    skonto1Days: 7,
    skonto2Permille: 10,
    skonto2Days: 14,
  });

  it("Treffer innerhalb der Frist mit vollem Skonto-Betrag", () => {
    const paidAt = new Date(Date.UTC(2034, 5, 10, 23, 59, 0));
    const hit = detectSkonto(terms, paidAt, 116620, 119000);
    expect(hit?.days).toBe(7);
  });

  it("kein Treffer ausserhalb der Frist", () => {
    const paidAt = new Date(Date.UTC(2034, 5, 25));
    expect(detectSkonto(terms, paidAt, 116620, 119000)).toBeNull();
  });

  it("kein Treffer bei Teilzahlung unter dem Skonto-Zahlbetrag", () => {
    const paidAt = new Date(Date.UTC(2034, 5, 9));
    expect(detectSkonto(terms, paidAt, 50000, 119000)).toBeNull();
  });

  it("Zahlung am Fristende (Tagesende) zaehlt noch", () => {
    const paidAt = new Date(Date.UTC(2034, 5, 10, 23, 59, 59, 999));
    expect(detectSkonto(terms, paidAt, 116620, 119000)?.days).toBe(7);
  });

  it("kein Treffer, wenn der Zahlbetrag nicht mehr offen ist (bereits beglichen)", () => {
    const paidAt = new Date(Date.UTC(2034, 5, 10));
    expect(detectSkonto(terms, paidAt, 116620, 116620)).toBeNull();
  });

  // G-detectSkonto: alte Regel (amountCents >= payableCents - 1) erkannte JEDE Zahlung
  // zwischen dem Skonto-Zahlbetrag und dem vollen offenen Betrag als "Skonto genommen" —
  // z. B. 999,99 € auf eine 1.000,00-€-Forderung (nur 1 Cent fehlt zum vollen Preis,
  // kein Skonto-Bezug erkennbar). Jetzt muss der Zahlbetrag INNERHALB ±1 Cent zum
  // Skonto-Zahlbetrag liegen.
  it("999,99 € auf eine 1.000,00-€-Forderung mit 2 %/7 Tage Skonto -> kein Treffer", () => {
    const smallTerms = skontoTerms({
      issueDate,
      grossTotalCents: 100000,
      skonto1Permille: 20,
      skonto1Days: 7,
      skonto2Permille: null,
      skonto2Days: null,
    });
    const paidAt = new Date(Date.UTC(2034, 5, 9));
    expect(detectSkonto(smallTerms, paidAt, 99999, 100000)).toBeNull();
  });

  it("Teilzahlung: Rest passt NICHT zum Skontobetrag des Terms -> kein Treffer", () => {
    // openBeforeCents (90000) weicht vom vollen Rechnungsbetrag (119000) ab, z. B.
    // durch eine vorherige Anzahlung — der Zahlbetrag trifft zwar payableCents (7 Tage),
    // aber der resultierende Rest (90000 - 116620 < 0) kann nicht zum Skontobetrag passen.
    const paidAt = new Date(Date.UTC(2034, 5, 9));
    expect(detectSkonto(terms, paidAt, 116620, 90000)).toBeNull();
  });
});

describe("paymentTermsText", () => {
  it("formatiert Skonto- und Nettofrist", () => {
    const terms = skontoTerms({
      issueDate: new Date(Date.UTC(2034, 5, 3)),
      grossTotalCents: 119000,
      skonto1Permille: 20,
      skonto1Days: 7,
      skonto2Permille: null,
      skonto2Days: null,
    });
    const netDueDate = new Date(Date.UTC(2034, 5, 17));
    expect(paymentTermsText(terms, netDueDate)).toBe(
      `2 % Skonto bei Zahlung bis 10.06.2034 (Skontobetrag ${formatCents(2380)}), zahlbar netto bis 17.06.2034.`,
    );
  });
});

describe("xrechnungSkontoNote", () => {
  it("erzeugt BT-20-Syntax mit zwei Nachkommastellen und Punkt", () => {
    const terms = skontoTerms({
      issueDate,
      grossTotalCents: 119000,
      skonto1Permille: 20,
      skonto1Days: 7,
      skonto2Permille: 10,
      skonto2Days: 14,
    });
    expect(xrechnungSkontoNote(terms, "Zahlbar netto bis 17.06.2034.")).toBe(
      "#SKONTO#TAGE=7#PROZENT=2.00#\n#SKONTO#TAGE=14#PROZENT=1.00#\nZahlbar netto bis 17.06.2034.",
    );
  });
});
