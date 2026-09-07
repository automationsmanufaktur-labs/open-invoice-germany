/**
 * Phase 8a, Task 1 (§28-§31) — Zod-Schemas der Kundendomain: Adressen, Ansprechpartner,
 * benutzerdefinierte Kundenfelder (Definitionen + Werte), Kundenvorgaben.
 */
import { describe, it, expect } from "vitest";
import {
  customerAddressInputSchema,
  contactPersonInputSchema,
  customFieldDefinitionInputSchema,
  customFieldValuesSchema,
  customerDefaultsInputSchema,
  type CustomFieldDefinitionLike,
} from "@/schemas";

describe("customerAddressInputSchema (§29)", () => {
  const valid = {
    type: "SHIPPING",
    label: "Lager Nord",
    addressLine1: "Industriestr. 1",
    postalCode: "12345",
    city: "Berlin",
  };

  it("akzeptiert eine gueltige Adresse und setzt Defaults (countryCode DE, isDefault false)", () => {
    const parsed = customerAddressInputSchema.parse(valid);
    expect(parsed.countryCode).toBe("DE");
    expect(parsed.isDefault).toBe(false);
  });

  it("lehnt einen unbekannten type ab", () => {
    expect(customerAddressInputSchema.safeParse({ ...valid, type: "HOME" }).success).toBe(false);
  });

  it("lehnt leeres addressLine1 und zu lange Felder ab", () => {
    expect(customerAddressInputSchema.safeParse({ ...valid, addressLine1: "" }).success).toBe(false);
    expect(customerAddressInputSchema.safeParse({ ...valid, addressLine1: "x".repeat(121) }).success).toBe(false);
    expect(customerAddressInputSchema.safeParse({ ...valid, addressLine2: "x".repeat(121) }).success).toBe(false);
    expect(customerAddressInputSchema.safeParse({ ...valid, label: "x".repeat(61) }).success).toBe(false);
    expect(customerAddressInputSchema.safeParse({ ...valid, postalCode: "" }).success).toBe(false);
    expect(customerAddressInputSchema.safeParse({ ...valid, postalCode: "x".repeat(13) }).success).toBe(false);
    expect(customerAddressInputSchema.safeParse({ ...valid, city: "" }).success).toBe(false);
    expect(customerAddressInputSchema.safeParse({ ...valid, city: "x".repeat(81) }).success).toBe(false);
  });

  it("lehnt eine kleingeschriebene oder zu lange countryCode ab (2 Grossbuchstaben)", () => {
    expect(customerAddressInputSchema.safeParse({ ...valid, countryCode: "de" }).success).toBe(false);
    expect(customerAddressInputSchema.safeParse({ ...valid, countryCode: "DEU" }).success).toBe(false);
  });
});

describe("contactPersonInputSchema (§30)", () => {
  const valid = { firstName: "Anna", lastName: "Muster" };

  it("akzeptiert einen gueltigen Ansprechpartner und setzt isDefault=false", () => {
    const parsed = contactPersonInputSchema.parse(valid);
    expect(parsed.isDefault).toBe(false);
  });

  it("lehnt leere firstName/lastName und zu lange Felder ab", () => {
    expect(contactPersonInputSchema.safeParse({ ...valid, firstName: "" }).success).toBe(false);
    expect(contactPersonInputSchema.safeParse({ ...valid, lastName: "" }).success).toBe(false);
    expect(contactPersonInputSchema.safeParse({ ...valid, firstName: "x".repeat(61) }).success).toBe(false);
    expect(contactPersonInputSchema.safeParse({ ...valid, role: "x".repeat(61) }).success).toBe(false);
    expect(contactPersonInputSchema.safeParse({ ...valid, phone: "x".repeat(41) }).success).toBe(false);
    expect(contactPersonInputSchema.safeParse({ ...valid, mobile: "x".repeat(41) }).success).toBe(false);
  });

  it("lehnt eine ungueltige email ab, akzeptiert eine gueltige", () => {
    expect(contactPersonInputSchema.safeParse({ ...valid, email: "nicht-valide" }).success).toBe(false);
    expect(contactPersonInputSchema.safeParse({ ...valid, email: "anna@example.com" }).success).toBe(true);
  });
});

describe("customFieldDefinitionInputSchema (§31)", () => {
  const valid = { key: "referenz_intern", label: "Interne Referenz", type: "TEXT" };

  it("akzeptiert eine gueltige Definition mit Defaults", () => {
    const parsed = customFieldDefinitionInputSchema.parse(valid);
    expect(parsed.required).toBe(false);
    expect(parsed.sortOrder).toBe(0);
    expect(parsed.isActive).toBe(true);
  });

  it("lehnt einen key ab, der nicht mit Kleinbuchstaben beginnt oder Grossbuchstaben enthaelt", () => {
    expect(customFieldDefinitionInputSchema.safeParse({ ...valid, key: "1abc" }).success).toBe(false);
    expect(customFieldDefinitionInputSchema.safeParse({ ...valid, key: "Abc" }).success).toBe(false);
    expect(customFieldDefinitionInputSchema.safeParse({ ...valid, key: "a" }).success).toBe(false); // min 2 Zeichen
    expect(customFieldDefinitionInputSchema.safeParse({ ...valid, key: "ab-c" }).success).toBe(false);
  });

  it("lehnt einen unbekannten type ab", () => {
    expect(customFieldDefinitionInputSchema.safeParse({ ...valid, type: "ARRAY" }).success).toBe(false);
  });

  it("SELECT verlangt options (1..50 Eintraege), andere Typen lehnen options ab", () => {
    expect(customFieldDefinitionInputSchema.safeParse({ ...valid, type: "SELECT" }).success).toBe(false);
    expect(customFieldDefinitionInputSchema.safeParse({ ...valid, type: "SELECT", options: [] }).success).toBe(false);
    expect(
      customFieldDefinitionInputSchema.safeParse({ ...valid, type: "SELECT", options: ["A", "B"] }).success,
    ).toBe(true);
    expect(
      customFieldDefinitionInputSchema.safeParse({ ...valid, type: "SELECT", options: Array.from({ length: 51 }, (_, i) => `opt${i}`) })
        .success,
    ).toBe(false);
    expect(customFieldDefinitionInputSchema.safeParse({ ...valid, type: "TEXT", options: ["A"] }).success).toBe(false);
  });
});

describe("customFieldValuesSchema(definitions) (§31)", () => {
  const definitions: CustomFieldDefinitionLike[] = [
    { key: "notiz", label: "Notiz", type: "TEXT", required: false },
    { key: "rabatt_hinweis", label: "Rabatt-Hinweis", type: "NUMBER", required: false },
    { key: "vertrag_ab", label: "Vertrag ab", type: "DATE", required: false },
    { key: "vip", label: "VIP", type: "BOOLEAN", required: true },
    { key: "kategorie", label: "Kategorie", type: "SELECT", required: false, options: ["A", "B", "C"] },
  ];

  it("akzeptiert gueltige Werte je Typ", () => {
    const schema = customFieldValuesSchema(definitions);
    const parsed = schema.parse({
      notiz: "x".repeat(500),
      rabatt_hinweis: "12.3456",
      vertrag_ab: "2059-01-05",
      vip: true,
      kategorie: "B",
    });
    expect(parsed.vip).toBe(true);
  });

  it("TEXT: lehnt mehr als 500 Zeichen ab", () => {
    const schema = customFieldValuesSchema(definitions);
    expect(schema.safeParse({ notiz: "x".repeat(501), vip: true }).success).toBe(false);
  });

  it("NUMBER: nur Dezimal-String mit max. 4 Nachkommastellen, kein Float", () => {
    const schema = customFieldValuesSchema(definitions);
    expect(schema.safeParse({ rabatt_hinweis: "12.34567", vip: true }).success).toBe(false);
    expect(schema.safeParse({ rabatt_hinweis: "abc", vip: true }).success).toBe(false);
    expect(schema.safeParse({ rabatt_hinweis: "-5.5", vip: true }).success).toBe(true);
    expect(schema.safeParse({ rabatt_hinweis: "5", vip: true }).success).toBe(true);
  });

  it("DATE: verlangt ISO YYYY-MM-DD", () => {
    const schema = customFieldValuesSchema(definitions);
    expect(schema.safeParse({ vertrag_ab: "05.01.2059", vip: true }).success).toBe(false);
    expect(schema.safeParse({ vertrag_ab: "2059-01-05", vip: true }).success).toBe(true);
  });

  it("SELECT: nur Werte aus options", () => {
    const schema = customFieldValuesSchema(definitions);
    expect(schema.safeParse({ kategorie: "Z", vip: true }).success).toBe(false);
    expect(schema.safeParse({ kategorie: "A", vip: true }).success).toBe(true);
  });

  it("required: fehlender Pflichtwert (vip) wird abgelehnt", () => {
    const schema = customFieldValuesSchema(definitions);
    expect(schema.safeParse({}).success).toBe(false);
  });

  it("unbekannte Keys werden abgelehnt", () => {
    const schema = customFieldValuesSchema(definitions);
    expect(schema.safeParse({ vip: true, unbekannt: "x" }).success).toBe(false);
  });

  it("optionale Felder duerfen fehlen", () => {
    const schema = customFieldValuesSchema(definitions);
    expect(schema.safeParse({ vip: false }).success).toBe(true);
  });
});

describe("customerDefaultsInputSchema (§28)", () => {
  it("akzeptiert ein leeres Objekt mit Defaults", () => {
    const parsed = customerDefaultsInputSchema.parse({});
    expect(parsed.defaultDiscountPermille).toBe(0);
    expect(parsed.eInvoicePreferred).toBe(false);
    expect(parsed.language).toBe("de");
  });

  it("currency: genau 3 Grossbuchstaben", () => {
    expect(customerDefaultsInputSchema.safeParse({ defaultCurrency: "eur" }).success).toBe(false);
    expect(customerDefaultsInputSchema.safeParse({ defaultCurrency: "EU" }).success).toBe(false);
    expect(customerDefaultsInputSchema.safeParse({ defaultCurrency: "EUR" }).success).toBe(true);
  });

  it("defaultDiscountPermille: 0..1000", () => {
    expect(customerDefaultsInputSchema.safeParse({ defaultDiscountPermille: -1 }).success).toBe(false);
    expect(customerDefaultsInputSchema.safeParse({ defaultDiscountPermille: 1001 }).success).toBe(false);
    expect(customerDefaultsInputSchema.safeParse({ defaultDiscountPermille: 1000 }).success).toBe(true);
  });

  it("invoiceCc: kommagetrennte E-Mails, maximal 5", () => {
    const ok = "a@example.com,b@example.com,c@example.com,d@example.com,e@example.com";
    const tooMany = ok + ",f@example.com";
    expect(customerDefaultsInputSchema.safeParse({ invoiceCc: ok }).success).toBe(true);
    expect(customerDefaultsInputSchema.safeParse({ invoiceCc: tooMany }).success).toBe(false);
    expect(customerDefaultsInputSchema.safeParse({ invoiceCc: "a@example.com,nicht-valide" }).success).toBe(false);
  });

  it("language: zwei Kleinbuchstaben", () => {
    expect(customerDefaultsInputSchema.safeParse({ language: "DE" }).success).toBe(false);
    expect(customerDefaultsInputSchema.safeParse({ language: "deu" }).success).toBe(false);
    expect(customerDefaultsInputSchema.safeParse({ language: "de" }).success).toBe(true);
  });
});
