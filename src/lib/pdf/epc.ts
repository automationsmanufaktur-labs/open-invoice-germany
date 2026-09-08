/**
 * EPC-QR-Code-Payload ("GiroCode") nach dem European Payments Council-Standard
 * (SEPA Credit Transfer, "EPC069-12"). Reine, DB-freie Funktion — Phase 7, Task 3 (§37).
 *
 * Format (11 Zeilen, LF-getrennt, KEIN Trailing-Newline):
 *   BCD | 002 | 1 | SCT | <BIC oder leer> | <Name> | <IBAN> | EUR<amount> | | | <remittance>
 * `amount` = (cents/100).toFixed(2), also z. B. "119.00". Byte-Länge (UTF-8) darf 331
 * nicht überschreiten (EPC-Spezifikation, Version 002).
 */

export class EpcError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EpcError";
  }
}

const MAX_PAYLOAD_BYTES = 331;
const MAX_NAME_LENGTH = 70;
const MIN_AMOUNT_CENTS = 1;
const MAX_AMOUNT_CENTS = 99_999_999_999;

export interface EpcPayloadInput {
  /** Name des Zahlungsempfängers (Beneficiary Name). */
  name: string;
  /** IBAN — Leerzeichen werden entfernt, Groß-/Kleinschreibung normalisiert. */
  iban: string;
  /** BIC — optional, leer wenn nicht vorhanden. */
  bic?: string | null;
  /** Betrag in Cent (> 0). */
  amountCents: number;
  /** Verwendungszweck (Remittance Information, unstrukturiert). */
  remittance: string;
}

function normalizeIban(iban: string): string {
  return iban.replace(/\s+/g, "").toUpperCase();
}

function formatAmount(cents: number): string {
  return (cents / 100).toFixed(2);
}

/**
 * Baut die EPC-QR-Code-Payload. Wirft `EpcError` bei jeder Verletzung der
 * EPC-Spezifikation (Name > 70 Zeichen, Betrag außerhalb 0,01–999.999.999,99 EUR,
 * resultierende Payload > 331 Byte).
 */
export function buildEpcPayload(input: EpcPayloadInput): string {
  const name = input.name.trim();
  if (name.length === 0 || name.length > MAX_NAME_LENGTH) {
    throw new EpcError(`Name des Zahlungsempfängers muss 1-${MAX_NAME_LENGTH} Zeichen lang sein.`);
  }
  if (!Number.isInteger(input.amountCents) || input.amountCents < MIN_AMOUNT_CENTS || input.amountCents > MAX_AMOUNT_CENTS) {
    throw new EpcError(`Betrag muss zwischen ${MIN_AMOUNT_CENTS} und ${MAX_AMOUNT_CENTS} Cent liegen.`);
  }

  const iban = normalizeIban(input.iban);
  const bic = (input.bic ?? "").trim().toUpperCase();
  const amount = formatAmount(input.amountCents);

  const lines = ["BCD", "002", "1", "SCT", bic, name, iban, `EUR${amount}`, "", "", input.remittance];
  const payload = lines.join("\n");

  const byteLength = Buffer.byteLength(payload, "utf8");
  if (byteLength > MAX_PAYLOAD_BYTES) {
    throw new EpcError(`EPC-Payload überschreitet die maximale Länge von ${MAX_PAYLOAD_BYTES} Byte (${byteLength} Byte).`);
  }

  return payload;
}
