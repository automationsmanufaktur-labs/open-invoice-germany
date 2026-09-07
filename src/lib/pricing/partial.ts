/**
 * Rechenkern für Teil-, Abschlags- und Schlussrechnungen (§ 13/§ 14 Abs. 5 UStG,
 * Abschn. 14.8 UStAE). Bewusst frei von Prisma/Next-Importen — reine Cent-Arithmetik,
 * wie `allocate.ts`/`tax.ts`.
 *
 * `splitByTaxRate` berechnet den Anteil einer Teil-/Abschlagsrechnung je
 * Steuersatz-Bucket der Quelle (Gesamtleistung):
 *
 *   a) Anteil in Promille (`{ permille }`): je Bucket unabhängig
 *      netCents_i = round(bucket.netCents * permille / 1000),
 *      taxCents_i = round(netCents_i * taxRate_i / 100), grossCents_i = netCents_i + taxCents_i.
 *
 *      Rechenbeispiel (Abschlag 30 %, Gesamtleistung 10.000,00 € netto/19 %):
 *        bucket = { taxRate: 19, netCents: 1_000_000 }, permille = 300
 *        netCents  = round(1_000_000 * 300 / 1000)      = 300_000  (3.000,00 €)
 *        taxCents  = round(300_000 * 19 / 100)           =  57_000  (  570,00 €)
 *        grossCents = 300_000 + 57_000                   = 357_000  (3.570,00 €)
 *
 *   b) Festbetrag netto (`{ amountCents, isGross: false }`): der Betrag wird
 *      Largest-Remainder-proportional zum Netto der Buckets verteilt (Summe der
 *      Ergebnis-Nettobeträge ist exakt `amountCents`), danach je Bucket wie oben
 *      die Steuer aufgeschlagen.
 *
 *   c) Festbetrag brutto (`{ amountCents, isGross: true }`): der Bruttobetrag wird
 *      Largest-Remainder-proportional zum BRUTTO-Gewicht der Buckets verteilt
 *      (Gewicht = netCents * (100 + taxRate), ganzzahlig — vermeidet Floats und ist
 *      proportional zum tatsächlichen Bruttoanteil des Buckets an der Gesamtleistung).
 *      Je Bucket wird danach ein Netto zurueckgerechnet und ueber `reconcileNetsForGross`
 *      (Fix-Welle, B5) so nachjustiert, dass `net_i + roundHalfUp(net_i*taxRate_i/100)`
 *      — DIESELBE Formel, die `computeTaxBreakdown` beim Persistieren erneut anwendet,
 *      nicht `grossCents_i - netCents_i` — in Summe exakt `amountCents` trifft.
 *      **Keine Exaktheitsgarantie bei genau einem Steuersatz-Bucket:** ohne einen
 *      zweiten Bucket zum Ausgleich ist ein Teil der Zielbetraege rechnerisch gar nicht
 *      erreichbar (bei 19 % z. B. 31.933 von 200.000 moeglichen Cent-Betraegen) — in
 *      diesem Fall bleibt die kleinstmoegliche Abweichung (i. d. R. ±1 Cent) bestehen,
 *      dokumentiert in `docs/LIMITATIONEN.md` statt stillschweigend als exakt behauptet.
 *
 *      Rechenbeispiel (gemischte Sätze 19 % / 7 %, Bruttobetrag 1.000,00 €;
 *      Gesamtleistung netto 500,00 €/19 % und 500,00 €/7 %):
 *        weights = [50_000 * 119, 50_000 * 107] = [5_950_000, 5_350_000]
 *        grossCents = allocateProportional(100_000, weights) = [52_655, 47_345]
 *          (exakte Anteile: 100000*5950000/11300000 = 52654,87 → LRM rundet den
 *           größeren Bruchteil auf; Summe exakt 100_000)
 *        netCents_19  = round(52_655 * 100 / 119) = 44_248
 *        taxCents_19  = 52_655 - 44_248            =  8_407
 *        netCents_7   = round(47_345 * 100 / 107) = 44_248
 *        taxCents_7   = 47_345 - 44_248            =  3_097
 *        Summe Brutto = 52_655 + 47_345            = 100_000  (= amountCents, exakt)
 *
 * `deductionsFor` zieht die auf den Abschlagsrechnungen bereits ausgewiesenen
 * Beträge je Steuersatz von der Gesamtleistung (Schlussrechnung) ab und liefert
 * den Rest je Satz sowie in Summe (§ 14 Abs. 5 Satz 2 UStG — Doppelbesteuerung
 * vermeiden). Übersteigt die Summe der Abschläge je Satz die Gesamtleistung dieses
 * Satzes, wird ein `PricingError` geworfen (das schließt eine Überdeckung in Summe
 * automatisch aus, da die Summe nur aus nicht-negativen Je-Satz-Resten gebildet wird).
 *
 *   Rechenbeispiel (Gesamtleistung 10.000,00 €/19 %, zwei Abschläge à 3.000,00 €
 *   netto/570,00 € USt/3.570,00 € brutto):
 *     final    = { taxRate: 19, netCents: 1_000_000 } → taxCents 190_000, gross 1_190_000
 *     deducted = 2 × { netCents: 300_000, taxCents: 57_000, grossCents: 357_000 }
 *              = { netCents: 600_000, taxCents: 114_000, grossCents: 714_000 }
 *     remaining = { netCents: 400_000, taxCents: 76_000, grossCents: 476_000 }
 *              (4.000,00 € / 760,00 € / 4.760,00 €)
 */
import { roundHalfUp } from "../money";
import { allocateProportional, type RateBucket } from "./allocate";
import { PricingError } from "./errors";

/** Ergebnis von `splitByTaxRate`: Netto/USt/Brutto je Steuersatz-Bucket. */
export interface TaxRateSplit {
  key: string;
  taxRate: number;
  taxCategory: string;
  netCents: number;
  taxCents: number;
  grossCents: number;
}

/** Anteil entweder als Promille der Gesamtleistung oder als Festbetrag (netto/brutto). */
export type ShareInput = { permille: number } | { amountCents: number; isGross?: boolean };

function assertNonNegativeBuckets(buckets: readonly RateBucket[]): void {
  for (const b of buckets) {
    if (b.netCents < 0) {
      throw new PricingError(`netCents eines Buckets darf nicht negativ sein: ${b.netCents} (${b.key})`);
    }
    if (b.taxRate < 0) {
      throw new PricingError(`taxRate eines Buckets darf nicht negativ sein: ${b.taxRate} (${b.key})`);
    }
  }
}

function splitByPermille(buckets: readonly RateBucket[], permille: number): TaxRateSplit[] {
  if (!Number.isInteger(permille) || permille < 0 || permille > 1000) {
    throw new PricingError(`permille muss zwischen 0 und 1000 liegen: ${permille}`);
  }
  return buckets.map((b) => {
    const netCents = roundHalfUp((b.netCents * permille) / 1000);
    const taxCents = roundHalfUp((netCents * b.taxRate) / 100);
    return { key: b.key, taxRate: b.taxRate, taxCategory: b.taxCategory, netCents, taxCents, grossCents: netCents + taxCents };
  });
}

function splitByNetAmount(buckets: readonly RateBucket[], amountCents: number): TaxRateSplit[] {
  const netSum = buckets.reduce((s, b) => s + b.netCents, 0);
  if (amountCents > netSum) {
    throw new PricingError(`Betrag (${amountCents} Cent) übersteigt die Nettosumme (${netSum} Cent)`);
  }
  const weights = buckets.map((b) => b.netCents);
  const nets = allocateProportional(amountCents, weights);
  return buckets.map((b, i) => {
    const netCents = nets[i];
    const taxCents = roundHalfUp((netCents * b.taxRate) / 100);
    return { key: b.key, taxRate: b.taxRate, taxCategory: b.taxCategory, netCents, taxCents, grossCents: netCents + taxCents };
  });
}

function splitByGrossAmount(buckets: readonly RateBucket[], amountCents: number): TaxRateSplit[] {
  const grossSum = buckets.reduce((s, b) => s + roundHalfUp((b.netCents * (100 + b.taxRate)) / 100), 0);
  if (amountCents > grossSum) {
    throw new PricingError(`Betrag (${amountCents} Cent) übersteigt die Bruttosumme (${grossSum} Cent)`);
  }
  // Ganzzahliges Gewicht proportional zum Bruttoanteil des Buckets — vermeidet Floats,
  // das Verhältnis der Gewichte zueinander bleibt identisch zu netCents * (1 + taxRate/100).
  const weights = buckets.map((b) => b.netCents * (100 + b.taxRate));
  const grosses = allocateProportional(amountCents, weights);
  const naiveNets = grosses.map((g, i) => roundHalfUp((g * 100) / (100 + buckets[i].taxRate)));

  // B5 (Fix-Welle): `naiveNets` allein garantiert NICHT, dass die tatsaechlich
  // persistierte Bruttosumme exakt `amountCents` trifft — der Downstream-Persistenzpfad
  // (createDraftInvoiceWithinTx -> computeTaxBreakdown) berechnet die Steuer je Bucket
  // NEU als roundHalfUp(net*rate/100) statt `grossCents - netCents` zu uebernehmen; das
  // kann bei zwei unabhaengigen Rundungen ±1 Cent von der Zielsumme abweichen (siehe
  // Rechenbeispiel im Dateikopf). `reconcileNetsForGross` verschiebt bei Bedarf EIN
  // Bucket-Netto um ±1 Cent, um die Summe wieder exakt zu treffen — bei nur einem
  // Steuersatz-Bucket ist das rechnerisch nicht immer moeglich (kein zweiter Bucket zum
  // Ausgleich), die kleinstmoegliche Abweichung bleibt dann bestehen
  // (docs/LIMITATIONEN.md).
  const nets = reconcileNetsForGross(
    buckets.map((b, i) => ({ netCents: naiveNets[i], taxRate: b.taxRate })),
    amountCents,
  );

  return buckets.map((b, i) => {
    const netCents = nets[i];
    const taxCents = roundHalfUp((netCents * b.taxRate) / 100);
    return { key: b.key, taxRate: b.taxRate, taxCategory: b.taxCategory, netCents, taxCents, grossCents: netCents + taxCents };
  });
}

/**
 * B5/B6 (Fix-Welle): passt Bucket-Nettobetraege so an, dass ihre je Bucket NEU
 * berechnete Steuer (`net + roundHalfUp(net*rate/100)` — dieselbe Formel, die
 * `computeTaxBreakdown` beim Persistieren anwendet) in Summe exakt `targetGrossCents`
 * ergibt, statt sich auf eine bereits vorab (unabhaengig) berechnete Steuer je Bucket zu
 * verlassen. Versucht dazu, EIN Bucket-Netto um ±1 Cent zu verschieben. Gemeinsamer
 * Helper fuer `splitByGrossAmount` (Zielbetrag = angeforderter Bruttobetrag) und
 * `finalStornoLines` (`src/domain/invoice/cancel.ts`, Zielbetrag = `-payableCents`).
 *
 * Bei nur einem Steuersatz-Bucket ist eine Verschiebung oft wirkungslos (kein zweiter
 * Bucket zum Ausgleich) — `splitByGrossAmount` hat z. B. bei 19 % 31.933 von 200.000
 * Zielbetraegen, die grundsaetzlich unerreichbar sind (die Zielfunktion
 * `f(net) = net + round(net*0.19)` ueberspringt sie). In diesem Fall bleibt die
 * kleinstmoegliche Abweichung (meist ±1 Cent) bestehen — akzeptiert und in
 * `docs/LIMITATIONEN.md` dokumentiert, statt eine (falsche) Exaktheit zu behaupten.
 */
export function reconcileNetsForGross(buckets: readonly { netCents: number; taxRate: number }[], targetGrossCents: number): number[] {
  const grossFor = (netCents: number, taxRate: number) => netCents + roundHalfUp((netCents * taxRate) / 100);
  const nets = buckets.map((b) => b.netCents);
  const actual = nets.map((n, i) => grossFor(n, buckets[i].taxRate));
  let diff = targetGrossCents - actual.reduce((s, v) => s + v, 0);

  if (diff !== 0) {
    outer: for (const delta of [1, -1]) {
      for (let i = 0; i < buckets.length; i++) {
        const candidateNet = nets[i] + delta;
        if (candidateNet < 0) continue;
        const candidateGross = grossFor(candidateNet, buckets[i].taxRate);
        if (diff - (candidateGross - actual[i]) === 0) {
          nets[i] = candidateNet;
          diff = 0;
          break outer;
        }
      }
    }
  }

  return nets;
}

/**
 * Berechnet den Anteil einer Teil-/Abschlagsrechnung je Steuersatz-Bucket der
 * Quelle (Gesamtleistung) — siehe Rechenbeispiele im Dateikopf.
 */
export function splitByTaxRate(buckets: readonly RateBucket[], share: ShareInput): TaxRateSplit[] {
  assertNonNegativeBuckets(buckets);
  if (buckets.length === 0) return [];

  if ("permille" in share) {
    return splitByPermille(buckets, share.permille);
  }

  if (!Number.isInteger(share.amountCents) || share.amountCents < 0) {
    throw new PricingError(`amountCents muss eine nicht-negative Ganzzahl (Cent) sein: ${share.amountCents}`);
  }

  return share.isGross
    ? splitByGrossAmount(buckets, share.amountCents)
    : splitByNetAmount(buckets, share.amountCents);
}

/** Eine bereits ausgewiesene Abschlagszeile (Snapshot einer Abschlagsrechnung je Steuersatz). */
export interface DeductionInput {
  taxRate: number;
  taxCategory: string;
  netCents: number;
  taxCents: number;
  grossCents: number;
}

/** Rest je Steuersatz nach Abzug der Abschläge von der Gesamtleistung. */
export interface DeductionRateResult {
  taxRate: number;
  taxCategory: string;
  deductedNetCents: number;
  deductedTaxCents: number;
  deductedGrossCents: number;
  remainingNetCents: number;
  remainingTaxCents: number;
  remainingGrossCents: number;
}

export interface DeductionsSummary {
  perRate: DeductionRateResult[];
  totalDeductedNetCents: number;
  totalDeductedTaxCents: number;
  totalDeductedGrossCents: number;
  totalRemainingNetCents: number;
  totalRemainingTaxCents: number;
  totalRemainingGrossCents: number;
}

function bucketKey(taxRate: number, taxCategory: string): string {
  return `${taxRate}|${taxCategory}`;
}

/**
 * Zieht die Abschläge (`downpayments`, eine Zeile je Steuersatz je Abschlagsrechnung —
 * entspricht je einer `FinalInvoiceDeduction`-Zeile) von der Gesamtleistung
 * (`finalBuckets`) ab. Wirft `PricingError`, wenn die Summe der Abschläge je Satz die
 * Gesamtleistung dieses Satzes übersteigt (§ 14 Abs. 5 Satz 2 UStG: sonst würde die
 * Schlussrechnung eine negative Steuer je Satz ausweisen) — das schließt eine
 * Überdeckung in Summe automatisch aus.
 */
export function deductionsFor(
  finalBuckets: readonly RateBucket[],
  downpayments: readonly DeductionInput[],
): DeductionsSummary {
  assertNonNegativeBuckets(finalBuckets);

  const finalByKey = new Map<string, RateBucket>();
  for (const b of finalBuckets) {
    const key = bucketKey(b.taxRate, b.taxCategory);
    if (finalByKey.has(key)) {
      throw new PricingError(`Steuersatz-Bucket ${key} ist in finalBuckets mehrfach vorhanden`);
    }
    finalByKey.set(key, b);
  }

  const deductedByKey = new Map<string, { netCents: number; taxCents: number; grossCents: number }>();
  for (const d of downpayments) {
    if (d.netCents < 0 || d.taxCents < 0 || d.grossCents < 0) {
      throw new PricingError("Abschlagszeile darf keine negativen Beträge enthalten");
    }
    const key = bucketKey(d.taxRate, d.taxCategory);
    const acc = deductedByKey.get(key) ?? { netCents: 0, taxCents: 0, grossCents: 0 };
    acc.netCents += d.netCents;
    acc.taxCents += d.taxCents;
    acc.grossCents += d.grossCents;
    deductedByKey.set(key, acc);
  }

  // Jeder Steuersatz, der in einem Abschlag vorkommt, muss auch in der
  // Gesamtleistung existieren — sonst wäre der Abschlag keiner Position der
  // Schlussrechnung zuordenbar.
  for (const key of deductedByKey.keys()) {
    if (!finalByKey.has(key)) {
      throw new PricingError(`Abschlag mit Steuersatz-Bucket ${key} hat keine Entsprechung in der Gesamtleistung`);
    }
  }

  const perRate: DeductionRateResult[] = finalBuckets.map((b) => {
    const key = bucketKey(b.taxRate, b.taxCategory);
    const grossCents = roundHalfUp((b.netCents * (100 + b.taxRate)) / 100);
    const taxCents = grossCents - b.netCents;
    const deducted = deductedByKey.get(key) ?? { netCents: 0, taxCents: 0, grossCents: 0 };

    if (deducted.netCents > b.netCents || deducted.taxCents > taxCents || deducted.grossCents > grossCents) {
      throw new PricingError(
        `Summe der Abschläge übersteigt die Gesamtleistung für Steuersatz ${key} ` +
          `(Abschlag ${deducted.grossCents} Cent brutto > Gesamtleistung ${grossCents} Cent brutto)`,
      );
    }

    return {
      taxRate: b.taxRate,
      taxCategory: b.taxCategory,
      deductedNetCents: deducted.netCents,
      deductedTaxCents: deducted.taxCents,
      deductedGrossCents: deducted.grossCents,
      remainingNetCents: b.netCents - deducted.netCents,
      remainingTaxCents: taxCents - deducted.taxCents,
      remainingGrossCents: grossCents - deducted.grossCents,
    };
  });

  const totalDeductedNetCents = perRate.reduce((s, r) => s + r.deductedNetCents, 0);
  const totalDeductedTaxCents = perRate.reduce((s, r) => s + r.deductedTaxCents, 0);
  const totalDeductedGrossCents = perRate.reduce((s, r) => s + r.deductedGrossCents, 0);

  return {
    perRate,
    totalDeductedNetCents,
    totalDeductedTaxCents,
    totalDeductedGrossCents,
    totalRemainingNetCents: perRate.reduce((s, r) => s + r.remainingNetCents, 0),
    totalRemainingTaxCents: perRate.reduce((s, r) => s + r.remainingTaxCents, 0),
    totalRemainingGrossCents: perRate.reduce((s, r) => s + r.remainingGrossCents, 0),
  };
}

/** Minimale Zeilenform fuer `bucketsFromLines` — Quote-/Invoice-/DeliveryNote-Zeile. */
export interface BucketableLine {
  taxRate: number;
  taxCategory: string;
  lineNetCents: number;
}

/**
 * Gruppiert Positionen nach (Steuersatz, -kategorie) zu Steuersatz-Buckets fuer
 * `splitByTaxRate`/`bucketsGrossTotalCents` — gemeinsamer Helper fuer
 * `src/domain/invoice/partial.ts` und `src/domain/invoice/downpayment.ts` (Fix-Runde 1,
 * LOW: vorher zwei inhaltsgleiche Kopien).
 */
export function bucketsFromLines(lines: readonly BucketableLine[]): RateBucket[] {
  const map = new Map<string, RateBucket>();
  for (const l of lines) {
    const key = `${l.taxCategory}:${l.taxRate}`;
    const existing = map.get(key);
    if (existing) {
      existing.netCents += l.lineNetCents;
    } else {
      map.set(key, { key, taxCategory: l.taxCategory, taxRate: l.taxRate, netCents: l.lineNetCents });
    }
  }
  return [...map.values()];
}

/**
 * Bruttosumme ueber alle Steuersatz-Buckets (Gesamtleistung brutto) — Grundlage des
 * kumulativen Ueberbuchungs-Guards fuer PERCENT/NET_AMOUNT/GROSS_AMOUNT-Teilrechnungen
 * (Fix-Runde 1, HIGH) und fuer die 100-%-Abschlagsgrenze.
 */
export function bucketsGrossTotalCents(buckets: readonly RateBucket[]): number {
  return buckets.reduce((s, b) => s + roundHalfUp((b.netCents * (100 + b.taxRate)) / 100), 0);
}

/**
 * Formatiert einen Promille-Wert (0..1000) als deutsches Prozent-Literal ohne "%"-
 * Zeichen (der Aufrufer haengt es an) — glatte Zehntel ohne Nachkommastelle, sonst mit
 * genau einer (z. B. 335 -> "33,5", 300 -> "30"). Gemeinsamer Helper fuer die
 * Beschreibungstexte in `partial.ts`/`downpayment.ts` (Fix-Runde 1, LOW).
 */
export function formatPermilleDE(permille: number): string {
  // permille 335 (= 33,5 %) -> roundedTenths 335 -> "33,5"; permille 300 -> 300 -> "30".
  const roundedTenths = Math.round(permille);
  const isWhole = roundedTenths % 10 === 0;
  return (roundedTenths / 10).toLocaleString("de-DE", { minimumFractionDigits: isWhole ? 0 : 1, maximumFractionDigits: 1 });
}
