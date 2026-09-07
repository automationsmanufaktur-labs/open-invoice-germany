# COMPLIANCE.md — Rechtliche Anforderungen Rechnungssoftware (Deutschland)

**Single Source of Truth** für alle rechtlichen Anforderungen, gegen die diese kostenlose Open-Source-Rechnungssoftware gebaut, getestet und validiert wird.

**Stand: 2026-06-09** · Geltungsbereich: Deutschland (UStG/UStDV/AO/HGB/BGB/DSGVO + EU-Normen EN 16931, MwStSystRL)

---

## ⚠️ DISCLAIMER — bitte zuerst lesen

> **Dies ist KEINE Steuer- oder Rechtsberatung.** Dieses Dokument fasst recherchierte und gegen Primärquellen verifizierte Rechtslage zusammen, ersetzt aber nicht die Beratung durch einen Steuerberater oder Rechtsanwalt.
>
> - **GoBD-Konformität entsteht NICHT allein durch die Software.** Sie erfordert zusätzlich eine **Verfahrensdokumentation des Anwenders** (Beschreibung des konkreten Einsatzes vom Belegeingang bis zur Aufbewahrung). Die Software kann GoBD-Konformität nur *ermöglichen*, nicht *garantieren*.
> - **Stand 2026.** Steuer- und Handelsrecht ändern sich laufend (halbjährliche Zinsanpassungen, neue BMF-Schreiben, Gesetzesnovellen). Jede harte Zahl ist mit Stand-Datum versehen; vor Produktivnutzung gegen den jeweils aktuellen Normtext/BMF-Schreiben gegenprüfen.
> - **Ohne Gewähr.** Trotz Primärquellen-Verifikation können Fehler enthalten sein. Mit `[ungesichert]` markierte Aussagen beruhen auf Sekundärquellen oder Auslegung und sind vor rechtsverbindlicher Nutzung gesondert abzusichern.
> - **Vor Produktivnutzung:** Die in Abschnitt 11 gelisteten offenen Fragen mit einem Steuerberater klären.

---

## Inhalt

1. [§ 14 UStG — Pflichtangaben einer Rechnung](#1--14-ustg--pflichtangaben-einer-rechnung)
2. [§ 33/§ 34 UStDV — Kleinbetragsrechnung & Fahrausweis](#2--33-34-ustdv--kleinbetragsrechnung--fahrausweis)
3. [§ 19/§ 34a UStDV — Kleinunternehmer (Reform 2025)](#3--19--34a-ustdv--kleinunternehmer-reform-2025)
4. [E-Rechnungspflicht B2B + Formate (EN 16931)](#4-e-rechnungspflicht-b2b--formate-en-16931)
5. [B2G E-Rechnung + Leitweg-ID](#5-b2g-e-rechnung--leitweg-id)
6. [GoBD — Unveränderbarkeit, Verfahrensdoku, Nummernkreise](#6-gobd--unveränderbarkeit-verfahrensdokumentation-nummernkreise)
7. [Aufbewahrungsfristen (§ 147 AO / § 14b UStG / BEG IV)](#7-aufbewahrungsfristen--147-ao--14b-ustg--beg-iv)
8. [Reverse Charge, ig. Lieferung/Leistung, USt-IdNr/VIES, ZM](#8-reverse-charge--13b-ig-lieferungleistung-ust-idnrvies-zm)
9. [§ 25a Differenzbesteuerung (Gebrauchtwaren/Refurb)](#9--25a-differenzbesteuerung-gebrauchtwarenrefurb)
10. [OSS-Verfahren § 18j UStG (B2C EU)](#10-oss-verfahren--18j-ustg-b2c-eu)
11. [Storno/Korrektur/Gutschrift + § 14c + Skonto](#11-stornokorrekturgutschrift--14c--skonto-in-e-rechnung)
12. [Mahnwesen (Verzug, Verzugszinsen, Mahngebühren)](#12-mahnwesen--286-verzug--288-verzugszinsen-mahngebühren)
13. [DSGVO für Rechnungsdaten + E-Rechnung-Tooling](#13-dsgvo-für-rechnungsdaten--e-rechnung-tooling)
14. [Abschlags- und Schlussrechnungen (§ 14 Abs. 5 UStG)](#14-abschlags--und-schlussrechnungen--14-abs-5-ustg)
15. [UMSETZUNGS-MATRIX (Software-Pflichten)](#15-umsetzungs-matrix--software-pflichten)
16. [Offene rechtliche Fragen (mit Steuerberater klären)](#16-offene-rechtliche-fragen--vor-produktivnutzung-mit-steuerberater-klären)
17. [Quellenverzeichnis](#17-quellenverzeichnis)

---

## 1. § 14 UStG — Pflichtangaben einer Rechnung

**Kurzregel:** Eine umsatzsteuerlich ordnungsgemäße Vollrechnung muss nach **§ 14 Abs. 4 UStG** zehn Pflichtangaben enthalten (i.V.m. § 31 UStDV zu Leistungszeitpunkt/Identifizierbarkeit). Fallabhängig kommen Zusatzhinweise nach § 14a UStG hinzu. Eine Rechnung ist jedes Dokument, mit dem über eine Lieferung/Leistung abgerechnet wird (§ 14 Abs. 1).

### Pflichtangaben (§ 14 Abs. 4 UStG)

| Nr. | Pflichtangabe | Norm |
|-----|---------------|------|
| 1 | Vollständiger Name **und** Anschrift des leistenden Unternehmers **UND** des Leistungsempfängers (müssen sich eindeutig feststellen lassen) | § 14 Abs. 4 Nr. 1 UStG; § 31 Abs. 2 UStDV |
| 2 | Steuernummer **ODER** USt-IdNr. des leistenden Unternehmers | § 14 Abs. 4 Nr. 2 UStG |
| 3 | Ausstellungsdatum | § 14 Abs. 4 Nr. 3 UStG |
| 4 | Fortlaufende Nummer mit einer oder mehreren Zahlenreihen, **einmalig** vergeben (Rechnungsnummer) | § 14 Abs. 4 Nr. 4 UStG |
| 5 | Menge und Art (handelsübliche Bezeichnung) der Lieferung / Umfang und Art der sonstigen Leistung | § 14 Abs. 4 Nr. 5 UStG |
| 6 | Zeitpunkt der Lieferung/Leistung bzw. Vereinnahmung (Angabe des **Kalendermonats** genügt) | § 14 Abs. 4 Nr. 6 UStG; § 31 Abs. 4 UStDV |
| 7 | Nach Steuersätzen/Befreiungen aufgeschlüsseltes Entgelt (Netto) **sowie jede im Voraus vereinbarte Entgeltminderung** (Skonto/Rabatt/Bonus), sofern nicht bereits im Entgelt berücksichtigt | § 14 Abs. 4 Nr. 7 UStG |
| 8 | Anzuwendender Steuersatz und Steuerbetrag **ODER** im Fall der Steuerbefreiung ein Hinweis auf die Befreiung | § 14 Abs. 4 Nr. 8 UStG |
| 9 | Ggf. Hinweis auf Aufbewahrungspflicht des Leistungsempfängers (bei Bauleistungen an Privatpersonen) | § 14 Abs. 4 Nr. 9 UStG i.V.m. § 14b Abs. 1 S. 5 |
| 10 | Bei Abrechnung durch den Leistungsempfänger: Angabe **„Gutschrift"** | § 14 Abs. 4 Nr. 10 UStG |

### Rechnungsnummer — fortlaufend ≠ lückenlos

- Die Nummer muss **fortlaufend und einmalig** sein. Eine **lückenlose** Abfolge ist **NICHT** zwingend (Abschn. 14.5 Abs. 10 S. 4 UStAE).
- **Mehrere Nummernkreise** sind zulässig (zeitlich: Jahr/Monat/Woche; geografisch: Filialen/Betriebsstätten; organisatorisch: Organgesellschaften) — ebenso Kombinationen aus Ziffern und Buchstaben.
- **Einmaligkeit ist zwingend**, Lückenlosigkeit nicht. ABER: Unerklärte große Lücken können bei einer Betriebsprüfung als Indiz für nicht erfasste Umsätze gewertet werden und eine Schätzung auslösen → Lücken (Storno, Systemwechsel, Jahreswechsel) systematisch dokumentieren.

### Zusatzhinweise nach § 14a UStG (fallabhängig)

| Fall | Pflichthinweis | Norm |
|------|----------------|------|
| Reverse Charge | „Steuerschuldnerschaft des Leistungsempfängers" | § 14a Abs. 5 UStG |
| Reiseleistungen | „Sonderregelung für Reisebüros" | § 25 UStG |
| Differenzbesteuerung | „Gebrauchtgegenstände/Sonderregelung" o.ä. | § 14a Abs. 6 / § 25a |
| ig. Lieferung / Dreiecksgeschäft | USt-IdNr. von Leistendem **und** Empfänger | § 14a Abs. 1/3/7 |
| Steuerbefreiung allgemein | **Konkreter** Grund der Befreiung (z.B. „steuerfreie innergemeinschaftliche Lieferung"); Paragraf-Zitat nicht zwingend | § 14 Abs. 4 Nr. 8 |

### Fristen

- **Rechnungsstellung:** spätestens **6 Monate** nach Leistungsausführung — bei Leistungen an Unternehmer/jur. Personen sowie bei grundstücksbezogenen Werk-/sonstigen Leistungen (auch ggü. Privatpersonen). (§ 14 Abs. 2 S. 1–2 UStG)

**Quellen:** [§ 14 UStG](https://www.gesetze-im-internet.de/ustg_1980/__14.html) · [§ 31 UStDV](https://www.gesetze-im-internet.de/ustdv_1980/__31.html) · [§ 14a UStG](https://www.gesetze-im-internet.de/ustg_1980/__14a.html) · [HK Hamburg — Pflichtangaben](https://www.handelskammer-hamburg.de/recht-steuern/steuerrecht/umsatzsteuer-mehrwertsteuer/umsatzsteuer-mehrwertsteuer-national/umsatzsteuer-pflichtangaben-rechnungen-6680494)
**Stand:** 2026-06-09 (Wortlaut primärquellen-verifiziert gegen gesetze-im-internet.de)

---

## 2. § 33 / § 34 UStDV — Kleinbetragsrechnung & Fahrausweis

**Kurzregel:** Bis **250 € brutto** (Gesamtbetrag einschl. USt) genügt eine Kleinbetragsrechnung mit reduzierten Pflichtangaben — **keine** fortlaufende Nummer, **keine** Empfängerangaben.

### § 33 UStDV — Kleinbetragsrechnung (≤ 250 € brutto): abschließende Pflichtangaben

| Nr. | Angabe | Norm |
|-----|--------|------|
| 1 | Vollständiger Name **und** Anschrift des **leistenden** Unternehmers | § 33 S. 1 Nr. 1 UStDV |
| 2 | Ausstellungsdatum | § 33 S. 1 Nr. 2 UStDV |
| 3 | Menge/Art der Gegenstände bzw. Umfang/Art der sonstigen Leistung | § 33 S. 1 Nr. 3 UStDV |
| 4 | Entgelt **und** Steuerbetrag in **EINER Summe** (Bruttobetrag) **sowie** der anzuwendende Steuersatz — bei Steuerbefreiung ein Hinweis darauf (Steuerbefreiungshinweis steht innerhalb Nr. 4, **nicht** als eigene Nr. 5) | § 33 S. 1 Nr. 4 UStDV |

**Darf weggelassen werden** ggü. § 14 Abs. 4 UStG: Name/Anschrift des Empfängers · Steuernummer/USt-IdNr. des Leistenden · fortlaufende Rechnungsnummer · Leistungszeitpunkt · getrennter Netto-/Steuerausweis (Brutto + Steuersatz genügt).

**§ 33 NICHT anwendbar** (dann volle § 14/§ 14a-Angaben!): Fernverkauf (§ 3c), innergemeinschaftliche Lieferung (§ 6a), Reverse Charge (§ 13b). (§ 33 S. 3 UStDV)

### § 34 UStDV — Fahrausweis als Rechnung

- Pflicht: Name/Anschrift des Beförderers · Ausstellungsdatum · Entgelt+Steuerbetrag in einer Summe · Steuersatz **nur, wenn die Beförderung NICHT dem ermäßigten Satz (§ 12 Abs. 2 Nr. 10) unterliegt** (bei ermäßigtem 7 %-Satz entfällt die Steuersatz-Angabe; ohne Angabe gilt der ermäßigte Satz) · bei grenzüberschreitender Luftbeförderung: entsprechender Hinweis. (§ 34 Abs. 1 UStDV)
- Keine fortlaufende Nummer, kein Empfängername erforderlich.
- Grenzüberschreitende Personenbeförderung: zusätzlich Bescheinigung über inländischen Streckenanteil (§ 34 Abs. 2); gilt entsprechend im Reisegepäckverkehr (§ 34 Abs. 3).

### E-Rechnung: Dauerausnahmen

§§ 33, 34, 34a UStDV befreien **dauerhaft** (nicht nur Übergangszeit) von der **Ausstellungs**pflicht einer E-Rechnung — Kleinbetrag/Fahrausweis/Kleinunternehmer dürfen „immer als sonstige Rechnung" (Papier/PDF) übermittelt werden (§ 33 S. 4 / § 34 Abs. 1 S. 2 / § 34a S. 2 UStDV, Wachstumschancengesetz, seit 1.1.2025). **ABER:** Die **Empfangs**pflicht (§ 4) gilt seit 1.1.2025 für ALLE inländischen Unternehmer ohne Ausnahme.

**Quellen:** [§ 33 UStDV](https://www.gesetze-im-internet.de/ustdv_1980/__33.html) · [§ 34 UStDV](https://www.gesetze-im-internet.de/ustdv_1980/__34.html) · [BMF-FAQ E-Rechnung](https://www.bundesfinanzministerium.de/Content/DE/FAQ/e-rechnung.html)
**Stand:** 2026-06-09 (§ 33/§ 34-Wortlaut primärquellen-verifiziert)

---

## 3. § 19 / § 34a UStDV — Kleinunternehmer (Reform 2025)

**Kurzregel:** Seit **1.1.2025** sind Kleinunternehmer-Umsätze **echt steuerfrei** (statt „Steuer wird nicht erhoben"). Schwellen: Vorjahr ≤ **25.000 € netto** UND laufendes Jahr ≤ **100.000 € netto**. **Kein USt-Ausweis**, dafür **Pflicht-Hinweis** auf die Steuerbefreiung.

### Schwellen & Rechtsfolge (§ 19 Abs. 1 UStG, JStG 2024)

| | Vorher (bis 2024) | Ab 1.1.2025 |
|--|--|--|
| Untere Grenze (Vorjahr) | 22.000 € brutto | **25.000 € netto** (nicht überschritten) |
| Obere Grenze (lfd. Jahr) | 50.000 € brutto (Prognose) | **100.000 € netto** (nicht überschreitet) |
| Rechtsfolge | „wird nicht erhoben" | **echte Steuerbefreiung** |

- Gesamtumsatz wird **nach vereinnahmten Entgelten** (§ 10 Abs. 1 UStG) berechnet.
- **Unterjähriger Sofort-Wegfall:** Wird die **100.000-€-Grenze** im laufenden Jahr überschritten, endet die Befreiung **sofort** — **bereits der Umsatz, mit dem die Grenze überschritten wird**, ist regulär zu versteuern (nicht erst ab Folgejahr/-monat).
  - ⚠️ **Korrigierte Rechtsgrundlage:** Diese Sofort-Rechtsfolge ergibt sich aus dem Tatbestandsmerkmal „nicht überschreitet" in **§ 19 Abs. 1 Satz 1 UStG** i.V.m. **BMF-Schreiben v. 18.03.2025** (Abschn. 19.1) — **NICHT** aus § 19 Abs. 1 Satz 2 UStG (der regelt die Nicht-Anwendung anderer Vorschriften).

### Rechnungsangaben Kleinunternehmer (§ 34a UStDV — neu ab 1.1.2025)

| Nr. | Angabe |
|-----|--------|
| 1 | Name/Anschrift beider Parteien |
| 2 | Steuernummer **ODER** USt-IdNr. **ODER** Kleinunternehmer-IdNr. (KU-IdNr., § 19a) |
| 3 | Ausstellungsdatum |
| 4 | Menge/Art bzw. Umfang/Art der Leistung |
| 5 | Entgelt in **einer Summe** **MIT Hinweis auf die Steuerbefreiung** für Kleinunternehmer (§ 19 UStG) — **KEIN** USt-Ausweis, **KEIN** Steuersatz |
| 6 | Bei Abrechnung durch Leistungsempfänger: „Gutschrift" |

- **Hinweis-Formulierung:** umgangssprachlich ausreichend (z.B. „steuerfreier Kleinunternehmer"), wenn die Steuerfreiheit eindeutig bezeichnet wird (BMF 18.03.2025, Abschn. 14.7a). Der genaue Wortlaut ist **nicht** gesetzlich vorgeschrieben.
- Bei Kleinbetragsrechnung (§ 33) / Fahrausweis (§ 34): reduzierte Angaben, **aber der Steuerbefreiungs-Hinweis bleibt erforderlich**.

### E-Rechnung

- **Ausstellung:** Kleinunternehmer **befreit** (§ 34a S. 2 UStDV) — dürfen stets „sonstige Rechnung" (Papier/PDF) ausstellen.
- **Empfang:** **Pflicht** seit 1.1.2025 für ALLE, auch Kleinunternehmer (E-Mail-Postfach genügt).

### Risiko § 14c

Weist ein Kleinunternehmer dennoch USt gesondert aus, schuldet er den Betrag grundsätzlich nach **§ 14c Abs. 2 UStG**. → Der Kleinunternehmer-Modus darf **NIEMALS** einen USt-Betrag/Steuersatz erzeugen.
*Ausnahme bei Leistungen ausschließlich an Endverbraucher (keine Gefährdung des Steueraufkommens, EuGH C-378/21, BMF 27.02.2024)* — **[ungesichert]**: Reichweite im Kleinunternehmer-Kontext nicht primärquellen-verifiziert, im Einzelfall steuerberaterlich absichern.

### KU-IdNr. (§ 19a UStG — neu 2025)

Für EU-weite Inanspruchnahme der Befreiung in anderen Mitgliedstaaten (besonderes Meldeverfahren beim BZSt, quartalsweise Umsatzmeldungen). Für rein inländisch tätige Kleinunternehmer **nicht zwingend**; verwendbar als IdNr. in der Rechnung.

**Quellen:** [§ 19 UStG](https://www.gesetze-im-internet.de/ustg_1980/__19.html) · [§ 19a UStG](https://www.gesetze-im-internet.de/ustg_1980/__19a.html) · [§ 34a UStDV](https://www.gesetze-im-internet.de/ustdv_1980/__34a.html) · [BMF-Schreiben 18.03.2025 Kleinunternehmer](https://www.bundesfinanzministerium.de/Content/DE/Downloads/BMF_Schreiben/Steuerarten/Umsatzsteuer/Umsatzsteuer-Anwendungserlass/2025-03-18-sonderregelung-kleinunternehmer.pdf) · [§ 14c UStG](https://www.gesetze-im-internet.de/ustg_1980/__14c.html)
**Stand:** 2025-01-01 / BMF 2025-03-18

---

## 4. E-Rechnungspflicht B2B + Formate (EN 16931)

**Kurzregel:** Im inländischen **B2B** ist die E-Rechnung (strukturiertes Format nach **EN 16931**) Pflicht. **Empfang** seit 1.1.2025 für alle; **Ausstellung** gestaffelt bis 2028. PDF/Papier ist seit 2025 **keine** E-Rechnung, sondern „sonstige Rechnung".

### Definitionen (§ 14 Abs. 1 UStG)

- **E-Rechnung** = strukturiertes elektronisches Format, das ausgestellt, übermittelt und empfangen wird und elektronische Verarbeitung ermöglicht (konform EN 16931 / RL 2014/55/EU).
- **Sonstige Rechnung** = Papier oder anderes elektronisches Format (z.B. einfaches PDF).
- E-Rechnungspflicht gilt **nur inländisches B2B**, **nicht B2C**.

### Timeline E-Rechnung (§ 27 Abs. 38 UStG)

| Datum | Wer | Pflicht |
|-------|-----|---------|
| **01.01.2025** | Alle inländischen Unternehmer (auch Kleinunternehmer, steuerfreie Vermieter, Land-/Forstwirte) | **Empfangspflicht** ohne Übergang (E-Mail-Postfach genügt) |
| 2025–2026 | Alle Aussteller | Papier weiter zulässig; anderes E-Format (PDF) nur **mit Zustimmung** des Empfängers |
| bis 31.12.2027 | Aussteller mit Vorjahresumsatz (2026) ≤ **800.000 €** | Übergang: sonstige Rechnungen weiter erlaubt; EDI ohne EN-16931-Konformität bis 31.12.2027 |
| **01.01.2027** | Aussteller mit Vorjahresumsatz (2026) **> 800.000 €** | **Ausstellungspflicht** E-Rechnung |
| **01.01.2028** | ALLE inländischen B2B-Umsätze | **Ausstellungspflicht** ausnahmslos |

### Format-Tabelle

| Format | Syntax | EN-16931-konform? | Hinweis |
|--------|--------|-------------------|---------|
| **XRechnung** | UBL **oder** CII | ✅ ja | Deutscher CIUS zu EN 16931; reines XML |
| **ZUGFeRD/Factur-X ≥ 2.0.1 — Profil MINIMUM** | CII | ❌ **nein** | nicht zulässig |
| **ZUGFeRD/Factur-X ≥ 2.0.1 — Profil BASIC-WL** | CII | ❌ **nein** | nicht zulässig |
| **ZUGFeRD/Factur-X ≥ 2.0.1 — Profil BASIC** | CII | ✅ ja | zulässig |
| **ZUGFeRD/Factur-X ≥ 2.0.1 — Profil EN 16931 (COMFORT)** | CII | ✅ ja | zulässig |
| **ZUGFeRD/Factur-X ≥ 2.0.1 — Profil EXTENDED** | CII | ✅ ja | zulässig |
| **Peppol BIS Billing 3.0** | UBL | ✅ ja | zulässig |

- **Hybrid (ZUGFeRD):** PDF/A-3 mit eingebettetem CII-XML. Der **strukturierte XML-Teil ist führend** (BMF 15.10.2025); bei Abweichung zwischen XML und Bildteil ist der XML-Teil maßgebend.
- ZUGFeRD **vor 2.0.1** sowie MINIMUM/BASIC-WL gelten **NICHT** als gültige E-Rechnung.

### Wichtigste EN-16931-Kern-/Pflichtfelder (BT-Nummern)

| BT/BG | Feld | Bezug |
|-------|------|-------|
| BG-4 / BT-27, BT-31 | Seller (Name, USt-IdNr./Steuernr.) | § 14 Abs. 4 Nr. 1/2 |
| BG-7 / BT-44 | Buyer (Name) | § 14 Abs. 4 Nr. 1 |
| BT-1 | Rechnungsnummer | § 14 Abs. 4 Nr. 4 |
| BT-2 | Ausstellungsdatum | § 14 Abs. 4 Nr. 3 |
| BT-9 | Fälligkeitsdatum | (Mahnwesen) |
| BT-10 | **Buyer reference** (= Leitweg-ID im B2G; im B2B i.d.R. leer) | § 5 ERechV (B2G) |
| BT-13 | Referenz der Bestellung (Bestellnummer, Phase 4b) | § 14 Abs. 4 Nr. 5 (Leistungsbeschreibung/Bezug) |
| BT-20 | Payment terms (Zahlungs-/Skontobedingungen, Freitext) | § 14 Abs. 4 Nr. 7 |
| BT-154 | Freitext-Detailbeschreibung der Position (Rich-Text als Klartext, Phase 4b) | § 14 Abs. 4 Nr. 5 |
| BT-155 | Artikelnummer der Position (Phase 4b) | § 14 Abs. 4 Nr. 5 |
| BG-23 / BT-118, BT-119 | VAT category code + rate | § 14 Abs. 4 Nr. 8 |
| BT-121 | VAT category code (z.B. „AE" Reverse charge, „E" steuerbefreit) | § 14a |
| BG-25 / BT-129, BT-153 | Menge / Art der Leistung | § 14 Abs. 4 Nr. 5 |
| BG-27 / BT-136, BT-140 | Rabatt auf Zeilenebene (`AllowanceCharge`, Positionsrabatt) | § 14 Abs. 4 Nr. 7 (Entgeltminderung) |
| BG-28 / BT-141, BT-145 | Aufschlag auf Zeilenebene (`AllowanceCharge`) | § 14 Abs. 4 Nr. 7 |
| BG-20 / BT-92, BT-93, BT-96 | Rabatt auf Dokumentebene (`AllowanceCharge`, Belegrabatt) | § 14 Abs. 4 Nr. 7 |
| BG-21 / BT-99, BT-100, BT-103 | Aufschlag auf Dokumentebene (`AllowanceCharge`, Belegaufschlag) | § 14 Abs. 4 Nr. 7 |
| BT-107, BT-108 | Summe Zeilenrabatte / Summe Zeilenaufschläge (Netto-Summenfelder) | Rechenprobe EN 16931 |

> **[ungesichert]** Das konkrete Mapping der Reverse-Charge-/§-25a-/Steuerbefreiungs-Hinweise auf EN-16931-VAT-Category-Codes und Begründungstexte (BT-120/BT-121) ist gegen die aktuelle KoSIT/XRechnung-Spezifikation zu prüfen — nicht primärquellen-verifiziert.

### Ausnahmen von der E-Rechnungspflicht

Kleinbeträge ≤ 250 € brutto (§ 33 UStDV) · Fahrausweise (§ 34) · Kleinunternehmer-Ausstellung (§ 34a/§ 19) · B2C · bestimmte steuerfreie Umsätze (§ 4 Nr. 8–29). Pflichtangaben müssen im strukturierten XML **maschinenlesbar** enthalten sein.

**Quellen:** [§ 14 UStG](https://www.gesetze-im-internet.de/ustg_1980/__14.html) · [§ 27 UStG](https://www.gesetze-im-internet.de/ustg_1980/__27.html) · [BMF-FAQ E-Rechnung](https://www.bundesfinanzministerium.de/Content/DE/FAQ/e-rechnung.html) · [BMF-Schreiben 15.10.2025 obligatorische E-Rechnung](https://www.bundesfinanzministerium.de/Content/DE/Downloads/BMF_Schreiben/Steuerarten/Umsatzsteuer/Umsatzsteuer-Anwendungserlass/2025-10-15-einfuehrung-obligatorische-e-rechnung.html) · [Haufe — BMF E-Rechnung](https://www.haufe.de/finance/buchfuehrung-kontierung/bmf-schreiben-e-rechnung_186_634646.html)
**Stand:** 2026-06-09

---

## 5. B2G E-Rechnung + Leitweg-ID

**Kurzregel:** Im **B2G** (Rechnung an die öffentliche Hand) ist die E-Rechnung des Bundes seit **27.11.2020** Pflicht (ERechV). Pflichtformat: **XRechnung**, alternativ jedes EN-16931-konforme Format. Kern-Pflichtfeld: die **Leitweg-ID** (BT-10). **Wichtig:** B2G (ERechV, Leitweg-ID, BMI) ist rechtlich getrennt von der B2B-Pflicht (§ 14 UStG, BMF) — im B2B gibt es **keine** Leitweg-ID.

### B2G-Eckdaten (ERechV)

| Anforderung | Wert/Norm |
|-------------|-----------|
| Rechtsgrundlage | ERechV (auf § 4a EGovG), in Kraft 27.11.2018; subzentrale Auftraggeber 27.11.2019 |
| Lieferantenpflicht (Bund) | seit **27.11.2020** (§ 3 ERechV) |
| Bagatellgrenze (Bund) | keine Pflicht bei **Direktauftrag ≤ 1.000 €** (§ 3 Abs. 3 ERechV) |
| Pflichtformat | XRechnung (§ 4 Abs. 1 ERechV); alternativ EN-16931-konform (z.B. ZUGFeRD ab Profil EN 16931/COMFORT) |
| Profil-Falle | MINIMUM/BASIC-WL erfüllen EN 16931 **nicht** → werden abgelehnt |

### Pflichtangaben B2G zusätzlich zu § 14 Abs. 4 UStG (§ 5 ERechV)

| Feld | Norm |
|------|------|
| **Leitweg-ID** in BT-10 „Buyer Reference" | § 5 Abs. 1 ERechV |
| Bankverbindung des Rechnungsstellers | § 5 Abs. 1 ERechV |
| Zahlungsbedingungen | § 5 Abs. 1 ERechV |
| De-Mail-/E-Mail-Adresse des Rechnungsstellers | § 5 Abs. 1 ERechV |
| Lieferantennummer (sofern vorher übermittelt) | § 5 Abs. 2 ERechV |
| Bestellnummer (sofern vorher übermittelt) | § 5 Abs. 2 ERechV |
| Alle USt-Pflichtangaben nach § 14 Abs. 4 UStG | bleiben zusätzlich erforderlich |

### Leitweg-ID — Format (KoSIT-Formatspezifikation v2.0.2, 28.07.2021)

- **Aufbau:** Grobadressierung **2–12 Ziffern** (numerisch) + optionale Feinadressierung **bis 30 alphanumerische Zeichen** + **2-stellige Prüfziffer**; Teile durch Bindestrich getrennt. Gesamtlänge ca. 5–46 Zeichen.
- **Prüfziffer:** nach **ISO/IEC 7064 Mod 97-10** (wie IBAN) — *primärquellen-bestätigt* in der KoSIT-Spezifikation.
- **Beispiele:** mit Feinadressierung `04011000-12345ABCXYZ-86`; ohne `991-0123456789-01`.
- **Erste zwei Stellen = Empfängerkreis:** 01 SH, 02 HH, 03 NI, 04 HB, 05 NW, 06 HE, 07 RP, 08 BW, 09 BY, 10 SL, 11 BE, 12 BB, 13 MV, 14 SN, 15 ST, 16 TH; **99 = Bund**.
- Die Leitweg-ID wird vom **öffentlichen Auftraggeber mitgeteilt** (Vertrag/Bestellung) — der Lieferant erfindet sie nicht selbst.

### ⚠️ KORRIGIERT — Bundes-Präfixe 991/992/993

> **Frühere Annahme (FALSCH/refuted):** 991 = unmittelbare, 992/993 = *mittelbare* Bundesverwaltung.
>
> **Korrekt (laut offizieller e-rechnung-bund.de-FAQ):** **Alle drei Präfixe gehören zur UNMITTELBAREN (direkten) Bundesverwaltung:**
> - **991** = unmittelbare Bundesverwaltung / Verfassungsorgan, Empfang über **OZG-RE**
> - **992** = unmittelbare Bundesverwaltung, Empfang über **OZG-RE**
> - **993** = unmittelbare Bundesverwaltung **mit Eigenlösung** (nicht über OZG-RE)

### ⚠️ Portal-Konsolidierung 2025

Das **ZRE** (Zentrales Rechnungseingangsportal, ITZBund) wurde am **19.09.2025 abgeschaltet**; die gesamte unmittelbare Bundesverwaltung wurde auf die **OZG-RE** migriert. Seither gibt es nur noch **EIN** Bundes-Eingangsportal (OZG-RE, Login `xrechnung-bdr.de`). Veraltete Doku, die 991 noch dem ZRE zuordnet, führt zu Zustellfehlern.

### Übermittlungswege OZG-RE

(1) Web-Erfassung · (2) Datei-Upload (XML) · (3) E-Mail · (4) **Peppol** (Adressierung Schema `0204:<Leitweg-ID>`; Leitweg-ID steht zusätzlich in BT-10).
> **[ungesichert]** Aussage „Peppol ist der EINZIGE Weg für vollautomatischen M2M-/Massenversand" nicht primärquellen-verifiziert (E-Mail-Route kann teilautomatisiert betrieben werden).

### Länder-B2G

> **[ungesichert]** Die Länder regeln B2G heterogen (abweichende Stichtage/Schwellen, teils nur Empfangs- statt Lieferantenpflicht). Konkrete Einzelwerte (z.B. 1.000-€-Schwelle BW/HH/SL, Stichtage HB 27.11.2020, SL/BW 01.01.2022) stammen aus Sekundärquellen — vor konkretem Mandat die jeweilige Landes-E-Rechnungsverordnung prüfen.

**Quellen:** [ERechV](https://www.gesetze-im-internet.de/erechv/BJNR355500017.html) · [§ 4 ERechV](https://www.gesetze-im-internet.de/erechv/__4.html) · [§ 5 ERechV](https://www.gesetze-im-internet.de/erechv/__5.html) · [KoSIT Leitweg-ID v2.0.2](https://leitweg-id.de/wp-content/uploads/2021/08/Leitweg-ID-Formatspezifikation-v2-0-2.pdf) · [e-rechnung-bund.de — Buyer Reference](https://e-rechnung-bund.de/en/faq/how-is-a-buyer-reference-structured/) · [e-rechnung-bund.de — Plattform-Konsolidierung](https://e-rechnung-bund.de/en/successful-platform-consolidation/)
**Stand:** 2026-06-09

---

## 6. GoBD — Unveränderbarkeit, Verfahrensdokumentation, Nummernkreise

**Kurzregel:** Die GoBD (BMF, zuletzt 2. Änderung 14.07.2025) konkretisieren §§ 145–147 AO / §§ 238 ff. HGB für die elektronische Buchführung. Vier Software-Kerngrundsätze: Nachvollziehbarkeit, Vollständigkeit, **Unveränderbarkeit**, zeitgerechte Erfassung. **GoBD-Konformität braucht zusätzlich eine Verfahrensdokumentation des Anwenders.**

### Unveränderbarkeit (§ 146 Abs. 4 AO, § 239 Abs. 3 HGB)

- Eine Buchung/Aufzeichnung darf **nicht** so verändert werden, dass der **ursprüngliche Inhalt nicht mehr feststellbar** ist; ebenso unzulässig sind Änderungen, bei denen ungewiss bleibt, ob sie ursprünglich oder später erfolgten.
- **Software-Anforderungen (GoBD Rz 107 ff.):** Einmal erfasste Daten dürfen nicht ohne Kenntlichmachung überschrieben/gelöscht/geändert werden. Sicherstellung per Schreibschutz, **Festschreibung (Lock)**, Protokollierung, **Historisierung/Versionierung** (Rz 58–60).
- **Korrekturen** festgeschriebener Belege nur per nachvollziehbarer **Storno-/Korrekturbuchung mit Protokoll**.
- Rz 109: Export in Office-Programm → unprotokolliertes Editieren → Reimport ist **unzulässig**. Ein schreibgeschütztes PDF erfüllt die Unveränderbarkeit **nicht**, wenn die Daten vorher unprotokolliert editierbar waren.
- **Festschreibung** zeitnah: Kasse täglich; laufende unbare Buchungen mindestens monatlich/analog USt-Voranmeldung. *(„monatlich"/„analog USt-VA" = Verwaltungs-/Literaturauslegung, keine starre Gesetzes-Tagesfrist — **[ungesichert]** Festschreibungsfrist.)*

### Verfahrensdokumentation (GoBD Rz 151–153)

- **Pflicht je DV-System**, größen-/rechtsformunabhängig. Vier Teile: (1) allgemeine Beschreibung, (2) Anwenderdokumentation, (3) technische Systemdokumentation, (4) Betriebsdokumentation.
- Muss den Prozess vom **Belegeingang bis zur Verbuchung/Aufbewahrung** abbilden, inkl. **aktueller UND historischer** Verfahrensstände über die Aufbewahrungsfrist (Rz 34).
- Keine gesetzliche Form / kein Pflicht-Muster; für KMU genügt eine kompakte individuelle Doku. Fehlen ist nur dann ein **schwerer Mangel** (mögliche Verwerfung der Buchführung), wenn Nachvollziehbarkeit/Nachprüfbarkeit beeinträchtigt sind.

### GoBD-Belegfunktion (Rz 77) — zusätzlich zu § 14 UStG

Eindeutige **Belegnummer** · Aussteller/Empfänger · Betrag bzw. Mengen-/Wertangaben · Währung/Wechselkurs bei Fremdwährung · Erläuterung des Geschäftsvorfalls · Belegdatum · ggf. verantwortlicher Aussteller. Geschäftsvorfälle müssen sich **lückenlos verfolgen** lassen (Rz 32).

### Zwei verschiedene „Lückenlosigkeits"-Begriffe (Stolperfalle)

| Begriff | Quelle | Anforderung |
|---------|--------|-------------|
| Rechnungsnummern-Folge | § 14 UStG / UStAE 14.5 Abs. 10 | **KEINE** lückenlose Folge nötig — nur Einmaligkeit |
| Geschäftsvorfälle | GoBD Rz 32 | **Lückenlose** Nachvollziehbarkeit nötig |

→ Software: **Einmaligkeit** + Storno-/Lücken-Dokumentation, **keine** erzwungene gap-free Sequenz, die Stornos verdeckt.

### Zeitgerechte Erfassung

- Unbare Geschäftsvorfälle grundsätzlich binnen **10 Tagen** (Rz 47); Kasse **täglich** (§ 146 Abs. 1 S. 2 AO); periodenweise zulässig, wenn unbare Vorfälle eines Monats bis Ablauf des Folgemonats gebucht und Belege gesichert sind (Rz 50).

### 2. GoBD-Änderung v. 14.07.2025 (E-Rechnungs-Archivierung)

Bei E-Rechnungen ist der **strukturierte XML-Teil** das **aufbewahrungspflichtige Original**, unverändert und maschinell auswertbar zu archivieren. Bei Hybridformaten (ZUGFeRD) muss der menschenlesbare PDF-Teil **nur dann** zusätzlich aufbewahrt werden, wenn er **zusätzliche/abweichende** steuerlich relevante Informationen enthält. Formatumwandlung des XML (nur PDF speichern) löscht das Original und ist **unzulässig**.

### Cloud/SaaS

Cloud-Nutzung ist der On-Premise-Speicherung gleichgestellt (GoBD Abschn. 1.11). Cloud außerhalb DE → Bewilligungs-/Mitteilungspflicht: EU-Mitgliedstaat ohne Bewilligung aber mit Mitteilung (§ 146 Abs. 2a AO), Drittstaat nur mit Bewilligung (§ 146 Abs. 2b AO).

> **[ungesichert]** Die zitierten Randziffern (Rz 32, 34, 47, 50, 58–60, 77, 107–112, 151–153) stammen überwiegend aus Sekundärquellen (Haufe/IHK/Steuerberater-Merkblätter Stand 2026); vor produktiver Nutzung gegen das BMF-GoBD-Volltext-PDF gegenprüfen. Die konkrete BStBl-Fundstelle „2025 I S. 1502" konnte nicht verifiziert werden; das 2025er Aktenzeichen lautet **IV D 2 - S 0316/00128/005/088**.

**Quellen:** [§ 146 AO](https://www.gesetze-im-internet.de/ao_1977/__146.html) · [§ 147 AO](https://www.gesetze-im-internet.de/ao_1977/__147.html) · [BMF GoBD 2. Änderung 14.07.2025](https://www.bundesfinanzministerium.de/Content/DE/Downloads/BMF_Schreiben/Weitere_Steuerthemen/Abgabenordnung/2025-07-14-GoBD-2-aenderung.html) · [§ 14 UStG / UStAE 14.5](https://datenbank.nwb.de/Dokument/378652_14___5/) · [BStBK GoBD-Praxisleitfaden](https://www.bstbk.de/downloads/bstbk/steuerrecht-und-rechnungslegung/fachinfos/BStBK_GoBD_Ein-Praxisleitfaden-fuer-Unternehmen.pdf)
**Stand:** 2026-01-01 / GoBD 2025-07-14

---

## 7. Aufbewahrungsfristen (§ 147 AO / § 14b UStG / BEG IV)

**Kurzregel:** Durch das **Vierte Bürokratieentlastungsgesetz (BEG IV)** wurde die Aufbewahrungsfrist für **Buchungsbelege und Rechnungen ab 1.1.2025 von 10 auf 8 Jahre** verkürzt. **ACHTUNG:** Nicht uniform — andere Unterlagen 6/10 Jahre; Finanzunternehmen bleiben dauerhaft bei 10 Jahren.

### Fristen-Matrix

| Unterlagenart | Frist | Norm |
|---------------|-------|------|
| **Buchungsbelege** (inkl. **Rechnungen**) | **8 Jahre** | § 147 Abs. 3 S. 1 AO / § 14b Abs. 1 S. 1 UStG / § 257 Abs. 4 HGB |
| Bücher, Aufzeichnungen, Inventare, Jahresabschlüsse, Lageberichte, Eröffnungsbilanz, Zollunterlagen (Nr. 1 u. 4a) | **10 Jahre** | § 147 Abs. 3 S. 1 AO |
| Sonstige Unterlagen (Geschäftsbriefe, Nr. 2/3/5) | **6 Jahre** | § 147 Abs. 3 S. 1 AO |
| Private Leistungsempfänger bei grundstücksbezogenen Bauleistungen | **2 Jahre** (Hinweispflicht des Leistenden) | § 14b Abs. 1 S. 5 UStG; nicht durch BEG IV geändert |

### Rechtsgrundlage & Übergangsrecht

- **BEG IV**, BGBl. 2024 I Nr. 323, ausgegeben 29.10.2024 (Gesetz v. 23.10.2024); fristrelevanter Teil in Kraft **1.1.2025**.
- **Rückwirkung:** Die 8-Jahres-Frist gilt für alle Rechnungen/Belege, deren bisherige Frist am **31.12.2024 noch nicht abgelaufen** war (§ 27 Abs. 40 S. 1 UStG; Art. 97 § 19a EGAO).
- **Fristbeginn:** mit **Schluss des Kalenderjahres** der Ausstellung/letzten Eintragung. Beispiel: Rechnung 2025 → Beginn 31.12.2025, 8 Jahre → bis Ende 2033.
- **Ablaufhemmung (§ 147 Abs. 3 S. 5 AO i.V.m. § 169 AO):** Die Frist endet **nicht**, solange die Unterlagen für eine **nicht abgelaufene Festsetzungsfrist** bedeutsam sind (laufende Außenprüfung, Einspruch, Vorbehaltsfestsetzung). **Die 8 Jahre sind eine MINDESTfrist** — Software darf **nicht automatisch** nach 8 Jahren löschen.

### ⚠️ KORRIGIERT — Finanzunternehmen: dauerhaft 10 Jahre

> **Frühere Annahme (FALSCH/refuted, war BEG-IV-Originalstand):** Banken/Versicherer/Wertpapierinstitute kämen „ein Jahr später" (ab 1.1.2026) ebenfalls auf 8 Jahre.
>
> **Korrekt (Stand 2026-06-09):** Das **Gesetz zur Modernisierung und Digitalisierung der Schwarzarbeitsbekämpfung (SchwarzArbMoDiG)**, Art. 17, BGBl. 2025 I Nr. 369 (v. 22.12.2025), hat die Verkürzung für **Kreditinstitute (KWG), Versicherungsunternehmen und Wertpapierinstitute zurückgenommen** — diese bleiben **dauerhaft bei der 10-Jahres-Frist** (Rückausnahme, betrifft §§ 19a EGAO, 147 Abs. 3 AO, 257 Abs. 4 HGB).
> → Pauschale „nach 8 Jahren vernichten"-Logik ist für diese Branchen falsch.

### Elektronische Aufbewahrung

- Zulässig auf Bild-/Datenträgern, wenn GoBD-konform (verfügbar, lesbar, maschinell auswertbar, unveränderbar) — § 147 Abs. 2 AO / § 257 Abs. 3 HGB.
- **Ausnahme HGB:** Eröffnungsbilanzen und (Konzern-)Abschlüsse im **Original** aufbewahren.
- **E-Rechnung:** mindestens der **strukturierte XML-Teil** unversehrt in ursprünglicher Form (BMF-FAQ).

**Quellen:** [§ 147 AO](https://www.gesetze-im-internet.de/ao_1977/__147.html) · [§ 14b UStG](https://www.gesetze-im-internet.de/ustg_1980/__14b.html) · [§ 257 HGB](https://www.gesetze-im-internet.de/hgb/__257.html) · [§ 27 UStG](https://www.gesetze-im-internet.de/ustg_1980/__27.html) · [BGBl. 2024 I Nr. 323 (BEG IV)](https://www.recht.bund.de/bgbl/1/2024/323/regelungstext.pdf?__blob=publicationFile&v=3) · [EY — Aufbewahrungsfristen Banken/Versicherungen](https://www.ey.com/de_de/technical/steuernachrichten/laengere-aufbewahrungsfristen-bei-banken-versicherungen-und-wertpapierinstituten)
**Stand:** 2026-06-09

---

## 8. Reverse Charge (§ 13b), ig. Lieferung/Leistung, USt-IdNr/VIES, ZM

**Kurzregel:** Grenz-/EU-bezogene Umsätze verschieben die Steuerschuld (Reverse Charge) bzw. befreien steuerfrei — mit **zwingenden** Rechnungs- und Meldepflichten. Die inhaltlichen Pflichten sind stabil; geändert hat sich nur die **Form** (E-Rechnung).

### (1) Reverse Charge (§ 13b UStG)

- **Zwingend, kein Wahlrecht:** Bei § 13b geht die Steuerschuld auf den Leistungsempfänger über.
- Der Leistende rechnet **OHNE** gesonderten USt-Ausweis ab (§ 14a Abs. 5 S. 2 schließt § 14 Abs. 4 S. 1 Nr. 8 aus) und **MUSS** den Pflichthinweis **„Steuerschuldnerschaft des Leistungsempfängers"** aufnehmen (§ 14a Abs. 5 S. 1). Bei Auslandsbezug ggf. anderssprachige Formel nach Art. 226 Nr. 11a MwStSystRL (z.B. „Reverse charge").
- Falscher USt-Ausweis → Schuld nach **§ 14c Abs. 1 UStG** bis zur Berichtigung; Empfänger hat keinen Vorsteuerabzug aus dem zu Unrecht ausgewiesenen Betrag.

### (2) Innergemeinschaftliche Lieferung (§ 4 Nr. 1b i.V.m. § 6a UStG)

- Steuerfrei **nur**, wenn der Abnehmer eine **gültige, von einem anderen Mitgliedstaat erteilte USt-IdNr.** verwendet (§ 6a Abs. 1 Nr. 4 — **materielle** Voraussetzung seit Quick Fixes 1.1.2020).
- Befreiung entfällt **rückwirkend**, wenn die **Zusammenfassende Meldung (ZM)** nicht/unrichtig/unvollständig abgegeben wurde (§ 4 Nr. 1b — materielle Voraussetzung seit 2020).
- Buch- und Belegnachweis (§ 6a Abs. 3 i.V.m. §§ 17a–17c UStDV; EU-Gelangensvermutung Art. 45a MwSt-DVO 282/2011).
- Rechnung: USt-IdNr. **beider** Parteien + Hinweis auf Steuerbefreiung; Ausstellung bis **15. Tag des Folgemonats** (§ 14a Abs. 3).

### (3) ig. sonstige Leistung (§ 3a Abs. 2)

- Reverse Charge beim Empfänger im Bestimmungsland; Rechnung bis 15. Tag des Folgemonats, USt-IdNr. beider Parteien + „Steuerschuldnerschaft des Leistungsempfängers" (§ 14a Abs. 1).

### (3a) Drittland-Leistung (§ 3a Abs. 2 UStG — Nicht-EU)

- **Ort der Leistung** beim Empfänger im Drittland (außerhalb EU) → **nicht im Inland steuerbar** (kein USt-Ausweis, kein Steuersatz).
- **Keine USt-IdNr.-Pflicht** für den Empfänger (Drittland), keine ZM-Meldung.
- **EN 16931 Steuerkategorie:** `O` (Out of scope) — nicht `G` (Export/Waren), nicht `AE` (Reverse Charge/EU), nicht `Z` (Nullsatz).
- **Pflichthinweis:** „Nicht im Inland steuerbar gem. § 3a Abs. 2 UStG" (§ 14 Abs. 4 Nr. 8 — bei Steuerfreiheit/nicht-Steuerbarkeit Hinweis erforderlich).
- **Abgrenzung zu `G` (Ausfuhrlieferung):** `G` = Warenexport § 4 Nr. 1 i.V.m. § 6 UStG (Gegenstand geht ins Drittland). `O` = sonstige Leistung, bei der der Ort nach § 3a Abs. 2 im Ausland liegt — kein Warenexport.
- **Währung:** Fremdwährung (z.B. USD) zulässig; GoBD-Belegfunktion (Rz 77) erfordert Währung/Wechselkurs-Angabe.
- **Quellen:** [§ 3a UStG](https://www.gesetze-im-internet.de/ustg_1980/__3a.html) · [§ 14 Abs. 4 Nr. 8 UStG](https://www.gesetze-im-internet.de/ustg_1980/__14.html)
**Stand:** 2026-08-17

### USt-IdNr.-Prüfung (§ 18e UStG / VIES)

| Anfrage-Art | Prüft | Nachweiswert |
|-------------|-------|--------------|
| Einfache Bestätigung | nur Gültigkeit der USt-IdNr. | gering |
| **Qualifizierte Bestätigung** | Gültigkeit **+** Name, Ort, PLZ, Straße | **guter Glaube** bei Betriebsprüfung |

- Kostenlos beim **BZSt** (Online-Einzelabfrage oder XML-RPC/REST); technisch via EU-**VIES**.
- **Vertrauensschutz (§ 6a Abs. 4):** greift nur, wenn der Unternehmer die unrichtigen Abnehmer-Angaben bei Sorgfalt eines ordentlichen Kaufmanns nicht erkennen konnte. **[ungesichert]** Konkrete Prüf-Intervalle sind nicht gesetzlich fixiert (BFH-Einzelfall) — Praxisempfehlung: qualifizierte Anfrage initial je Geschäftsbeziehung + periodisch.

### Zusammenfassende Meldung (§ 18a UStG)

| Anforderung | Wert |
|-------------|------|
| Meldegegenstand | ig. Warenlieferungen, ig. Dreiecksgeschäfte (§ 25b), ig. sonstige Leistungen (§ 3a Abs. 2) |
| Frist | bis **25. Tag** nach Ablauf des Meldezeitraums, elektronisch ans BZSt |
| Meldezeitraum | grundsätzlich Kalendermonat; **quartalsweise**, wenn Warenlieferungen/§25b-Geschäfte weder im laufenden noch in einem der 4 vorangegangenen Quartale **> 50.000 €** lagen; ig. sonstige Leistungen quartalsweise möglich |
| Angaben | je Abnehmer: USt-IdNr. + Summe der Bemessungsgrundlagen; Hinweis auf Dreiecksgeschäfte (§ 18a Abs. 7) |
| Berichtigung | bei nachträglich erkannter Unrichtigkeit **innerhalb eines Monats** (§ 18a Abs. 10) |

### Pflichtangaben pro Fall (Rechnung)

| Fall | Pflichthinweis / Besonderheit |
|------|-------------------------------|
| Reverse Charge (§ 13b) | „Steuerschuldnerschaft des Leistungsempfängers"; **kein** USt-Ausweis, **kein** Steuersatz |
| ig. Lieferung | USt-IdNr. Leistender **und** Abnehmer; Hinweis z.B. „steuerfreie innergemeinschaftliche Lieferung" |
| ig. sonstige Leistung (§ 3a Abs. 2) | USt-IdNr. beider + „Steuerschuldnerschaft des Leistungsempfängers" |
| ig. Dreiecksgeschäft (§ 25b) | Hinweis auf Dreiecksgeschäft + Steuerschuldnerschaft des letzten Abnehmers (§ 14a Abs. 7) |

**Quellen:** [§ 13b UStG](https://www.gesetze-im-internet.de/ustg_1980/__13b.html) · [§ 14a UStG](https://www.gesetze-im-internet.de/ustg_1980/__14a.html) · [§ 4 UStG](https://www.gesetze-im-internet.de/ustg_1980/__4.html) · [§ 6a UStG](https://www.gesetze-im-internet.de/ustg_1980/__6a.html) · [§ 18a UStG](https://www.gesetze-im-internet.de/ustg_1980/__18a.html) · [BZSt — Bestätigung ausländischer USt-IdNr.](https://www.bzst.de/DE/Unternehmen/Identifikationsnummern/Umsatzsteuer-Identifikationsnummer/AuslaendischeUSt-IdNr/auslaendische_ust_idnr_node.html)
**Stand:** 2026-06-09 (Wortlaut primärquellen-verifiziert)

---

## 9. § 25a Differenzbesteuerung (Gebrauchtwaren/Refurb)

**Kurzregel:** Gewerbliche Wiederverkäufer (z.B. Refurb-Händler) versteuern **nur die Marge** (Verkaufspreis − Einkaufspreis, ohne darin enthaltene USt). **Kern-Pflichthinweis:** „Gebrauchtgegenstände/Sonderregelung"; **kein** gesonderter USt-Ausweis.

### Voraussetzungen & Mechanik

| Aspekt | Regel | Norm |
|--------|-------|------|
| Anwendung | Wiederverkäufer; Gegenstand im Gemeinschaftsgebiet **ohne** USt-Ausweis erworben (Privat, Kleinunternehmer, anderer Differenzbesteuerer). Edelsteine/Edelmetalle ausgenommen | § 25a Abs. 1 |
| Bemessungsgrundlage | **Marge** (VK − EK); enthaltene USt herausrechnen. Bsp.: 250 € Bruttomarge → 250 / 1,19 × 0,19 = **39,92 €** USt | § 25a Abs. 3 |
| Steuersatz | **stets 19 %** (allgemeiner Satz); **keine** 7 %-Ermäßigung | § 25a Abs. 5 S. 1 i.V.m. § 12 Abs. 1 |
| Vorsteuerabzug | **kein** Abzug aus dem differenzbesteuerten Einkauf | § 25a Abs. 5 S. 3 |
| Gesamtdifferenz-Vereinfachung | nur für Gegenstände mit Einkaufspreis **≤ 750 €** (**ab 1.1.2025** angehoben von 500 €) | § 25a Abs. 4 S. 2 (JStG 2024 / BEG IV) |
| Ausschluss | u.a. wenn der Gegenstand als steuerfreie ig. Lieferung geliefert wurde; neue Fahrzeuge | § 25a Abs. 7 |

### PFLICHT-Rechnungsangaben (§ 25a)

| Anforderung | Norm |
|-------------|------|
| § 14 Abs. 4 Nr. 1–6 (Name/Anschrift beider, Steuernr./USt-IdNr., Datum, fortlaufende Nr., Menge/Art, Lieferzeitpunkt) | § 14 Abs. 4 |
| Entgelt = **Verkaufspreis (brutto)** — **KEINE** Aufteilung in Netto + USt; Marge wird **nicht** ausgewiesen | — |
| **PFLICHTHINWEIS** „Gebrauchtgegenstände/Sonderregelung" (für Refurb-Elektronik) bzw. „Kunstgegenstände/Sonderregelung" / „Sammlungsstücke und Antiquitäten/Sonderregelung" | **§ 14a Abs. 6 S. 1** |
| **KEIN** gesonderter USt-Ausweis (kein Steuersatz, kein USt-Betrag) | § 14a Abs. 6 S. 2 i.V.m. § 14 Abs. 4 S. 1 Nr. 8 |
| Kleinbetragsrechnung ≤ 250 €: reduziert, **aber** § 25a-Hinweis bleibt | § 33 UStDV |

### Aufzeichnung (§ 25a Abs. 6 i.V.m. § 22)

Getrennt: Verkaufspreise, Einkaufspreise, Margen. Bei Gesamtdifferenz entfällt die Einzelzuordnung für Gegenstände ≤ 750 €. **Ankaufsbeleg/Gutschrift** beim Privatankauf: **darf keine USt ausweisen** (Privatverkäufer schuldet keine USt). **[ungesichert]** exakter Mindestinhalt des Ankaufsbelegs — mit Steuerberater abstimmen.

### Risiko § 14c Abs. 2

Wird trotz Differenzbesteuerung **USt offen ausgewiesen** (z.B. durch ein Shop-System, das automatisch 19 % aufschlüsselt), schuldet der Händler diese Steuer **zusätzlich** zur § 25a-Steuer. → Refurb-Shop niemals 19 % offen auf differenzbesteuerten Belegen ausweisen lassen.

### E-Rechnung

Die B2B-E-Rechnungspflicht gilt **auch** für § 25a-Umsätze; § 25a-Hinweis + Steuerausweis-Verbot müssen im strukturierten EN-16931-Datensatz korrekt abgebildet werden. B2C-Endkundenverkäufe (typischer Refurb-Fall) fallen **nicht** unter die Pflicht; Kleinbeträge ≤ 250 € ausgenommen.

**Quellen:** [§ 25a UStG](https://www.gesetze-im-internet.de/ustg_1980/__25a.html) · [§ 14a UStG](https://www.gesetze-im-internet.de/ustg_1980/__14a.html) · [HK Hamburg — Differenzbesteuerung](https://www.handelskammer-hamburg.de/recht-steuern/steuerrecht/umsatzsteuer-mehrwertsteuer/umsatzsteuer-mehrwertsteuer-national/differenzbesteuerung-gebrauchtwarenhandel-6680498) · [BMF-FAQ E-Rechnung](https://www.bundesfinanzministerium.de/Content/DE/FAQ/e-rechnung.html)
**Stand:** 2026-06-09 (§ 25a/§ 14a primärquellen-verifiziert)

---

## 10. OSS-Verfahren § 18j UStG (B2C EU)

**Kurzregel:** Das **OSS-Verfahren** (EU-Regelung, seit 1.7.2021) erlaubt, die im EU-Ausland anfallende USt für **B2C-Fernverkäufe** (§ 3c) und bestimmte **B2C-Leistungen** (§ 3a Abs. 5) **zentral beim BZSt** zu erklären — statt Einzelregistrierung je Land. **EINE** EU-weite Bagatellgrenze von **10.000 € netto** ersetzt die alten Lieferschwellen.

### Kernlogik

| Aspekt | Regel | Norm |
|--------|-------|------|
| Anwendung | ig. Fernverkäufe (§ 3c Abs. 1), über elektronische Schnittstelle unterstützte Lieferungen (§ 3 Abs. 3a), B2C-Leistungen (§ 3a Abs. 5 S. 2) | § 18j Abs. 1 |
| Bagatellgrenze | EU-weit **10.000 € netto** (Summe **aller** grenzüberschreitenden B2C-Fernverkäufe **+** TRFE-Leistungen, Vorjahr **und** lfd. Jahr); nur bei Ansässigkeit in **einem** Mitgliedstaat | § 3c Abs. 4 S. 1 |
| Unter Schwelle | Leistungsort = Ursprungsland (deutsche USt) | § 3c Abs. 4 |
| Über Schwelle / Verzicht | Leistungsort = **Bestimmungsland** (Steuersatz des Verbrauchsmitgliedstaats) — sofort ab dem grenzüberschreitenden Umsatz, mit dem die Grenze überschritten wird | § 3c Abs. 1 |
| Verzicht auf Bagatelle | freiwillig sofort im Bestimmungsland; bindet **mindestens 2 Kalenderjahre** | § 3c Abs. 4 S. 2/3 |

### Erklärung & Zahlung

| Anforderung | Wert |
|-------------|------|
| Besteuerungszeitraum | **Kalenderquartal** |
| Frist Erklärung **+** Zahlung | bis **Ende des Folgemonats**: Q1→30.04., Q2→31.07., Q3→31.10., Q4→31.01. (auch **Nullmeldungen**) |
| Pflichtangaben je Umsatz | Mitgliedstaat des Verbrauchs, Bemessungsgrundlage (netto, EUR), **Steuersatz des Verbrauchsmitgliedstaats**, Steuerbetrag; ggf. Korrekturbereich |
| Währung | EUR; bei Landeswährung EZB-Kurs des letzten Quartalstags (BMF 01.04.2021) |
| Vorsteuer | **KEIN** Abzug über OSS — ausländische Vorsteuer nur über separates Vorsteuervergütungsverfahren (§ 18 Abs. 9 / RL 2008/9/EG) |
| Aufzeichnungen | **10 Jahre** (Art. 369k MwStSystRL); auf Anforderung elektronisch ans BZSt/EU |

### Rechnung

Bei OSS-Teilnahme **entfällt** die Rechnungsausstellungspflicht für die betroffenen ig. Fernverkäufe (§ 3c Abs. 1) — **§ 14a Abs. 2 S. 2 UStG**. Stellt der Unternehmer dennoch (auf Kundenwunsch) eine Rechnung aus, richten sich die Anforderungen nach dem Recht des Registrierungsstaats (i.d.R. DE, § 14/§ 14a), wobei der Steuersatz des Bestimmungslandes auszuweisen ist.

> **[ungesichert]** Wirksamkeitszeitpunkt der OSS-Registrierung (Regelfall: erster Tag des folgenden Kalenderquartals; Sonderfall rückwirkend ab erstem Umsatz bei Anzeige bis 10. des Folgemonats, Art. 369b MwStSystRL) ist im § 18j Abs. 1-Wortlaut nicht direkt belegt — am BZSt/BMF-Primärtext verifizieren.
> **[ungesichert]** Zusammenspiel mit der EU-Kleinunternehmer-Sonderregelung (§ 19a) sowie produktspezifische ermäßigte Sätze je Zielland separat prüfen.

**Quellen:** [§ 18j UStG](https://www.gesetze-im-internet.de/ustg_1980/__18j.html) · [§ 3c UStG](https://www.gesetze-im-internet.de/ustg_1980/__3c.html) · [§ 3a UStG](https://www.gesetze-im-internet.de/ustg_1980/__3a.html) · [§ 14a UStG](https://www.gesetze-im-internet.de/ustg_1980/__14a.html) · [BZSt — One-Stop-Shop EU](https://www.bzst.de/DE/Unternehmen/Umsatzsteuer/One-Stop-Shop_EU/one_stop_shop_eu_node.html)
**Stand:** 2026-06-09

---

## 11. Storno/Korrektur/Gutschrift + § 14c + Skonto in E-Rechnung

**Kurzregel:** Maßgeblich ist das **BMF-Schreiben v. 15.10.2025** (GZ III C 2 - S 7287-a/00019/007/243), das das Erst-Schreiben v. 15.10.2024 (BStBl I S. 1320) ändert. Berichtigung einer E-Rechnung muss **selbst E-Rechnung** sein; § 17-Fälle (Skonto) erfordern **keine** Rechnungsberichtigung.

### Korrektur / Berichtigung (§ 31 Abs. 5 UStDV)

- Es genügt, die fehlenden/unzutreffenden Angaben in einem Dokument zu übermitteln, das **spezifisch und eindeutig** auf die Ursprungsrechnung bezogen ist (Datum + Rechnungsnummer); gleiche Anforderungen wie § 14.
- **WICHTIG E-Rechnung:** Die Berichtigung muss in der vorgeschriebenen Form (**entsprechender Rechnungstyp**) erfolgen. **PDF/Papier genügt NICHT**, solange E-Rechnungspflicht besteht (BMF Abschn. 14.11). Ausnahme: kein E-Rechnungszwang (Übergang § 27 Abs. 38) → Berichtigung auch ohne E-Rechnung.

### Gutschrift — zwei Bedeutungen

| Typ | Bedeutung | Folge |
|-----|-----------|-------|
| **Echte (umsatzsteuerliche) Gutschrift** | Abrechnung durch den **Leistungsempfänger** (§ 14 Abs. 2 S. 5) | **vorherige Vereinbarung** nötig; zwingend Angabe „Gutschrift" (§ 14 Abs. 4 Nr. 10); B2B-Inland **E-Rechnungspflicht**; Widerspruch (Satz 6) beseitigt Rechnungswirkung; bei E-Rechnung Kennzeichnung über Rechnungstyp |
| **Kaufmännische Gutschrift** | umgangssprachlich für Storno/Korrektur | **keine** § 14c-Schuld allein durch die Bezeichnung. **[ungesichert]** (BMF 25.10.2013, BStBl I 2013, 1305 nur sekundär belegt). Besser „Korrekturrechnung"/„Storno-Rechnung" |

### § 14c UStG (JStG 2024, ab 06.12.2024)

| Fall | Regel | Berichtigung |
|------|-------|--------------|
| **Abs. 1** — zu hoher Ausweis | Mehrbetrag geschuldet | über § 17 Abs. 1 ggü. Empfänger; **kein** Antrag/FA-Zustimmung nötig |
| **Abs. 2** — unberechtigter Ausweis | ausgewiesener Betrag geschuldet | **nur** nach Beseitigung der Gefährdung (kein/zurückgezahlter Vorsteuerabzug beim Empfänger) **+ schriftlicher Antrag + FA-Zustimmung**, dann analog § 17 Abs. 1 |

- Hybrid-E-Rechnung: **strukturierter Teil führend**. **[ungesichert]** Höherer Ausweis nur im Bildteil/Abweichung kann §-14c-Risiko begründen (Auslegung, nicht im BMF-Schreiben ausdrücklich als § 14c benannt).

### Skonto in E-Rechnung (Kernfrage)

- § 14 Abs. 4 S. 1 Nr. 7 verlangt **jede im Voraus vereinbarte Entgeltminderung**. Bei Skonto genügt eine **Freitext-Angabe** wie „2 % Skonto bei Zahlung bis …". Das Skonto muss **NICHT betragsmäßig** ausgewiesen werden (BMF 15.10.2025, Abschn. 14.5 Abs. 19 S. 11–12).
- **Spätere Zahlung unter Skontoausnutzung** = Änderung der Bemessungsgrundlage nach § 17 UStG → **keine** Rechnungsberichtigung (§ 31 Abs. 5) nötig; Belegaustausch nur in § 17 Abs. 4-Fällen, Beleg muss keine USt-Rechnung sein.
- EN 16931: Skonto/Zahlungsbedingungen im Freitextfeld **BT-20**. **[ungesichert]** Eine strukturierte KoSIT-Konvention (`SKONTO TAGE=n PROZENT=n`) ist eine **technische Empfehlung zur Auswertbarkeit, KEINE umsatzsteuerliche Pflicht** — vor Produktiveinsatz gegen aktuelle KoSIT/XRechnung-Spezifikation testen.
- **Umsetzung dieser Software** (`src/lib/pricing/skonto.ts`, `src/lib/einvoice/mapper.ts`): Für bis zu zwei Skontoziele wird je Ziel eine Zeile `#SKONTO#TAGE=n#PROZENT=x.xx#` vor dem menschenlesbaren Zahlungsbedingungstext in BT-20 eingefügt (UBL **und** CII, `PaymentTerms`/`SpecifiedTradePaymentTerms`); der Betrag selbst wird **nicht** ausgewiesen, nur Frist und Prozentsatz — genügt der o.g. Freitext-Anforderung. Quelle für die Tag-Syntax: **XRechnung-Spezifikation 3.0.2 (KoSIT)**, Abschnitt „Zahlungsbedingungen"/BT-20 (`validator-configuration-xrechnung_3.0.2_2024-06-20`, s. `scripts/validate-erechnung.ts`); die Syntax ist — wie oben vermerkt — eine Auswertungs-Konvention, keine Schematron-Pflichtregel, und wird daher parallel zur Kernvalidierung (`npm run validate:erechnung`) gegen die offiziellen EN-16931-/XRechnung-CIUS-Schematron-Regeln getestet (13 Fixtures, u. a. `skonto-two-terms`). Fremdwährungs-Skonto (BT-20 nur in Rechnungswährung) ist **nicht** abgebildet.

### § 17-Fälle ohne Berichtigungspflicht (BMF Rn. 51a)

Skonti · Nachlässe wegen Mängelrügen **ohne** Auswirkung auf die abgerechnete Leistung · Rückgängigmachung (§ 17 Abs. 2 Nr. 3). **Abgrenzung (Rn. 51b):** Leistungsänderung (z.B. relevante Aufmaßänderung) ist **keine** bloße Bemessungsgrundlagen-Änderung → Berichtigung der Leistungsbeschreibung (ggf. per Gutschrift mit eindeutigem Bezug).

**Quellen:** [§ 14c UStG](https://www.gesetze-im-internet.de/ustg_1980/__14c.html) · [§ 14 UStG](https://dejure.org/gesetze/UStG/14.html) · [§ 31 UStDV](https://dejure.org/gesetze/UStDV/31.html) · [BMF-Schreiben 15.10.2025 (PDF)](https://www.bundesfinanzministerium.de/Content/DE/Downloads/BMF_Schreiben/Steuerarten/Umsatzsteuer/Umsatzsteuer-Anwendungserlass/2025-10-15-einfuehrung-obligatorische-e-rechnung.pdf)
**Stand:** 2026-06-09 (BMF-PDF seitenweise als Primärquelle ausgewertet)

---

## 12. Mahnwesen — § 286 Verzug, § 288 Verzugszinsen, Mahngebühren

**Kurzregel:** Verzug tritt durch **Mahnung** nach Fälligkeit ein; bei Entgeltforderungen spätestens **30 Tage** nach Fälligkeit + Rechnungszugang. Verzugszinsen **5 Pp** (mit Verbraucher) bzw. **9 Pp** (B2B) über Basiszins. **40-€-Pauschale** nur B2B. **B2C/B2B sauber trennen.**

### Verzugseintritt (§ 286 BGB)

| Fall | Regel |
|------|-------|
| Grundsatz | Mahnung nach Fälligkeit; Klageerhebung/Mahnbescheid gleichgestellt (Abs. 1) |
| Mahnung entbehrlich | kalendermäßige Bestimmung, Ereignisbezug, ernsthafte/endgültige Leistungsverweigerung, besondere Gründe (Abs. 2) |
| Entgeltforderung | spätestens **30 Tage** nach Fälligkeit **UND** Zugang einer Rechnung/gleichwertigen Zahlungsaufstellung (Abs. 3 S. 1) |
| **Verbraucher (B2C)** | 30-Tage-Automatik **nur** bei **ausdrücklichem Hinweis** in der Rechnung (Abs. 3 S. 1 Hs. 2) — **zentraler B2C/B2B-Unterschied** |
| Vertretenmüssen | kein Verzug ohne Vertretenmüssen (Abs. 4) |

### Verzugszinsen (§ 288 BGB, Basiszins § 247 BGB)

| Konstellation | Satz über Basiszins | Konkret ab 01.01.2026 |
|---------------|--------------------|-----------------------|
| Mit Verbraucher (B2C) | **5 Pp** | **6,27 % p.a.** |
| B2B-Entgeltforderung (kein Verbraucher) | **9 Pp** | **10,27 % p.a.** |

- **Basiszinssatz: 1,27 %** zum 01.01.2026 (Deutsche Bundesbank, unverändert ggü. H2 2025). ⚠️ **Bewegliches Ziel:** halbjährliche Anpassung (1.1. / 1.7.); **nächste zum 01.07.2026** — vor taggenauer Berechnung prüfen, ggf. je Zeitabschnitt den geltenden Satz verwenden.

### 40-€-Verzugspauschale (§ 288 Abs. 5 BGB) — reines B2B-Instrument

- Anspruch **nur**, wenn Schuldner **kein Verbraucher** ist; verschuldensunabhängig, **ohne** gesonderte Mahnung.
- Fällt auch bei Abschlags-/Ratenzahlung an (S. 2); nach **EuGH 01.12.2022 (C-419/21)** je **verspäteter Zahlung/Rechnung** gesondert, auch bei Dauerverträgen.
- **Anrechnung** auf Schadensersatz wegen Rechtsverfolgungskosten (S. 3) — keine doppelte Geltendmachung.
- **Nicht abdingbar:** Verzugszins-Ausschluss kategorisch unwirksam (Abs. 6 S. 1); Pauschalen-/Rechtsverfolgungskosten-Ausschluss nur bei grober Unbilligkeit unwirksam, **im Zweifel als grob unbillig anzusehen** (S. 2/3); gilt nicht ggü. Verbrauchern (S. 4).
- **Arbeitsrecht-Sonderfall:** bei Lohn-/Gehaltsverzug **keine** Anwendung (BAG 25.09.2018, 8 AZR 26/18, wegen § 12a ArbGG).

### Mahngebühren — kein gesetzlicher Anspruch

- Nur als **konkreter Verzugsschaden** (§§ 280, 286 BGB) ersatzfähig: **tatsächlich** angefallene **Porto-/Material-/Druckkosten** (Praxisschätzung ca. 2,50–3 €; im BGH-Fall lagen ersatzfähige Kosten bei nur ~0,76 €). **NICHT** ersatzfähig: Personal-/Verwaltungs-/IT-Kosten.
- Pauschale Mahngebühren in AGB (z.B. 2,50 €) sind nach **BGH 26.06.2019 (VIII ZR 95/18)** und § 309 Nr. 5 BGB **unwirksam**, wenn sie den typischen Schaden übersteigen.
- **Erste, verzugsbegründende Mahnung NICHT ersatzfähig** (Verzug existiert noch nicht). Erst **Folgemahnungen** sind Verzugsschaden. Tritt Verzug **ohne** Mahnung ein (§ 286 Abs. 2/3), kann bereits die erste Mahnung ersatzfähig sein.
- Bei E-Mail-Mahnung entstehen i.d.R. keine ersatzfähigen Porto-/Materialkosten.

**Quellen:** [§ 286 BGB](https://www.gesetze-im-internet.de/bgb/__286.html) · [§ 288 BGB](https://www.gesetze-im-internet.de/bgb/__288.html) · [Bundesbank — Basiszinssatz 01.01.2026](https://www.bundesbank.de/de/presse/pressenotizen/bekanntgabe-des-basiszinssatzes-zum-1-januar-2026-basiszinssatz-bleibt-unveraendert-bei-1-27--973974) · [BGH VIII ZR 95/18](https://dejure.org/dienste/vernetzung/rechtsprechung?Gericht=BGH&Datum=26.06.2019&Aktenzeichen=VIII+ZR+95/18) · [EuGH C-419/21](https://dejure.org/dienste/vernetzung/rechtsprechung?Gericht=EuGH&Datum=01.12.2022&Aktenzeichen=C-419%2F21)
**Stand:** 2026-01-01 (Basiszins H1 2026)

### Umsetzung in der Software (Phase 6 — Mahnwesen/Scheduler)

- **Stufen-getriebene Logik statt fester Level 1–4:** Mahnstufen (`DunningStage`, je Organisation
  frei konfigurierbar: Name, Tage nach Fälligkeit, neue Zahlungsfrist, Mahnkosten, Zinsberechnung
  an/aus, B2B-Pauschale an/aus, Auto-Versand an/aus, aktiviert/deaktiviert, Reihenfolge) ersetzen
  die vier vormals hartkodierten Stufen. Vier Standardstufen werden je Organisation als Startwerte
  angelegt (weiterhin editierbar/deaktivierbar/erweiterbar), spiegeln aber keine gesetzliche
  Stufenzahl wider — das BGB kennt keine "Mahnstufen 1–4", nur die in Abschnitt 12 dargestellten
  Verzugsvoraussetzungen; die Softwarestufen sind ein rein betriebswirtschaftliches
  Eskalationsschema.
- **Mahnkosten (`feeCents`) nur ab der 2. Mahnstufe (`order ≥ 2`) — technisch erzwungen, nicht
  nur dokumentiert:** Zod (`dunningStageInputSchema`, `src/schemas/index.ts`) lehnt `feeCents > 0`
  auf Stufe 0/1 beim Anlegen/Ändern einer Stufe ab; `createDunning`
  (`src/domain/dunning/create.ts`) prüft `stage.order >= 2` zusätzlich defensiv vor dem
  Verbuchen. Grund (Abschnitt 12, "Mahngebühren"): die erste, verzugsbegründende Mahnung ist
  nicht ersatzfähig, erst Folgemahnungen sind Verzugsschaden — die Software verhindert damit,
  dass eine erste Mahnung versehentlich mit einer rechtlich nicht durchsetzbaren Gebühr versehen
  wird. Ob eine konkrete `feeCents`-Höhe im Einzelfall als "tatsächlich angefallener" Schaden
  (Porto/Material, ca. 2,50–3 €) durchsetzbar ist, bleibt Sache des Betreibers/Steuerberaters —
  die Software erzwingt nur die Stufenschranke, nicht die Angemessenheit der Höhe.
- **40-€-Pauschale** (`includeB2BFlatFee` je Stufe) nur, wenn der Kunde `isConsumer === false`
  ist, und höchstens einmal je Rechnung (`create.ts` prüft vor dem Verbuchen, ob bereits eine
  frühere Mahnung derselben Rechnung die Pauschale trägt) — unabhängig vom Zinsschalter, wie in
  Abschnitt 12 gefordert ("verschuldensunabhängig, ohne gesonderte Mahnung", "je verspäteter
  Zahlung/Rechnung gesondert", aber nicht mehrfach je Rechnung).
- **Verzugszinsen:** `DunningStage.calculateInterest` schaltet die Berechnung je Stufe frei;
  der Satz (5 Pp B2C / 9 Pp B2B über Basiszins) und die taggenaue Berechnung stammen unverändert
  aus `computeDunning`. **Basiszins-Pflege:** `DunningSettings.baseInterestRateBp` (Basispunkte,
  Default 127 = 1,27 %) und `DunningSettings.baseRateValidFrom` (Einstellungen → Mahnwesen) bilden
  den je Organisation hinterlegten, AKTUELL gültigen Basiszinssatz ab — bei der halbjährlichen
  Bundesbank-Anpassung (nächste zum 01.07.2026, siehe Quellen oben) muss der Betreiber den Wert
  manuell nachpflegen. **Bekannte Lücke (siehe `docs/LIMITATIONEN.md`):** es gibt keine Historie
  je Zeitabschnitt — eine Änderung wirkt sofort auf alle künftigen Zinsberechnungen; bereits
  gestellte Mahnungen (GoBD-Snapshot) bleiben unverändert, aber eine rückwirkend korrekte,
  abschnittsweise Verzinsung über einen Satzwechsel hinweg wird nicht automatisch berechnet.

---

## 13. DSGVO für Rechnungsdaten + E-Rechnung-Tooling

**Kurzregel:** DSGVO-**Löschpflicht** (Art. 17) und steuer-/handelsrechtliche **Aufbewahrungspflicht** kollidieren. Auflösung: **Art. 17 Abs. 3 lit. b** macht die Aufbewahrungspflicht zur **Löschausnahme** → statt Löschen wird die Verarbeitung **eingeschränkt** („Sperren"/Archivieren) bis zum Fristablauf.

### DSGVO-Anforderungen

| Anforderung | Regel | Norm |
|-------------|-------|------|
| Löschausnahme | Gesetzliche Aufbewahrungspflicht (§ 147 AO, § 257 HGB) **verdrängt** das Recht auf Löschung, solange die Frist läuft | Art. 17 Abs. 3 lit. b DSGVO |
| Statt Löschen → Sperren | **[ungesichert]** Verarbeitung einschränken (Soft-Delete/Archiv-Flag, separate Archivsysteme, eingeschränkte Zugriffsrechte) statt Hard-Delete | Art. 18 Abs. 1 lit. b/c DSGVO (dogmatische Verortung in Literatur uneinheitlich) |
| AVV bei Hosting | Self-Hosting vermeidet **NICHT** automatisch einen AVV. Maßgeblich: ob ein **externer Dienstleister** personenbezogene Daten weisungsgebunden verarbeitet. Hetzner/Plesk/Cloud = AVV nach Art. 28 nötig. **Erst echtes On-Premise ohne Fremd-Dienstleister** entkoppelt | Art. 28 DSGVO; Art. 4 Nr. 8 |
| Drittland | bei US-/Drittland-Subdienstleistern zusätzlich Transfer-Mechanismus | Art. 44 ff. DSGVO |

→ **Datenmodell-Konsequenz:** Jedes `delete` auf rechnungsrelevante Tabellen (Invoice, Lead) muss **Sperren/Archivieren erzwingen**, nicht Hard-Delete — sonst Verstoß gegen Aufbewahrungspflicht.

### OSS-/E-Rechnung-Tooling (Node/JS/JVM)

| Tool | Sprache / Lizenz | Funktion | Reifegrad |
|------|------------------|----------|-----------|
| **Mustangproject** | Java / Apache-2.0 | Erzeugen + Einbetten + Validieren (Factur-X/ZUGFeRD, XRechnung CII; UBL lesen); veraPDF integriert | reifstes JVM-Tool; via Subprozess/REST aus Node |
| **horstoeko/zugferd** | PHP / MIT | Lesen/Schreiben ZUGFeRD/XRechnung/Factur-X (CII, nicht UBL); PDF/A-3-Merge | reif; **[ungesichert]** Bus-Faktor (Maintainer sucht Mitwirkende) |
| **node-zugferd** | Node / MIT | ZUGFeRD/Factur-X-XML (CII) erzeugen + PDF/A-3b einbetten | **WIP v0.1.0** — produktiv riskant; keine vollständige EN-16931-Schematron-Validierung |
| **KoSIT-Validator** | Java / Apache-2.0 | offizielle Referenz-Engine (XML-Schema + Schematron); CLI/Library/HTTP-Daemon; braucht `validator-configuration-xrechnung` | **De-facto-Standard** für rechtsverbindliche XRechnung-Validierung |
| **veraPDF** | Open Source | PDF/A-3-Conformance-Prüfung des Container-PDFs | Industrie-Standard |

**Validierungs-Architektur (Pflicht für Verlässlichkeit):** Keine reine Node/JS-Lib führt die vollständige offizielle EN-16931-Schematron-Validierung aus. → **KoSIT-Validator-Jar** (als HTTP-Daemon-Sidecar) als Validierungs-Backend einbinden; für ZUGFeRD **zwei Ebenen**: (1) PDF/A-3 via veraPDF, (2) EN-16931-XML via KoSIT.

> **[ungesichert]** Versions-/Datumsangaben einzelner Tools (z.B. Mustang 2.23.1, ZUGFeRD 2.4.0, XRechnung 3.0.2, node-zugferd v0.1.0) liegen außerhalb des primärquellen-verifizierten Scopes — vor Einsatz gegen das jeweilige Repository abgleichen. Versions-Drift der Validator-Szenarien in CI aktuell halten.

**Quellen:** [Art. 17 / Art. 18 / Art. 28 DSGVO (EUR-Lex)](https://eur-lex.europa.eu/legal-content/DE/TXT/HTML/?uri=CELEX:32016R0679) · [§ 147 AO](https://www.gesetze-im-internet.de/ao_1977/__147.html) · [e-recht24 — Webhoster & Datenschutz/AVV](https://www.e-recht24.de/datenschutz/13053-webhoster-und-datenschutz.html) · [Mustangproject](https://github.com/ZUGFeRD/mustangproject/) · [horstoeko/zugferd](https://github.com/horstoeko/zugferd) · [node-zugferd](https://github.com/jslno/node-zugferd) · [KoSIT-Validator](https://github.com/itplr-kosit/validator)
**Stand:** 2026-06-09

---

## 14. Abschlags- und Schlussrechnungen (§ 14 Abs. 5 UStG)

**Kurzregel:** Anzahlungen (Abschlagsrechnungen) lösen die Steuer bereits bei **Vereinnahmung** aus (nicht erst bei Leistungserbringung); die abschließende **Schlussrechnung über die Gesamtleistung** muss die bereits abgerechneten Anzahlungen **und die darauf entfallende Steuer offen absetzen**, sonst droht ein doppelter Steuerausweis.

### Rechtsgrundlagen

| Norm | Regel |
|------|-------|
| § 13 Abs. 1 Nr. 1 Buchst. a Satz 4 UStG | Wird ein Entgelt (oder Teilentgelt) **vor** Ausführung der Leistung vereinnahmt, entsteht die Steuer dafür bereits mit Ablauf des Voranmeldungszeitraums der Vereinnahmung — unabhängig vom späteren Leistungszeitpunkt der Schlussrechnung. |
| § 14 Abs. 5 Satz 1 UStG | Wird vor Ausführung der Leistung eine Rechnung über die (Teil-)Zahlung erteilt, gilt § 14 Abs. 4 UStG sinngemäß (Abschlagsrechnung ist selbst eine vollwertige Rechnung mit allen Pflichtangaben). |
| § 14 Abs. 5 Satz 2 UStG | In der **Endrechnung über die Gesamtleistung** sind die vor Ausführung der Leistung **vereinnahmten Teilentgelte und die hierauf entfallenden Steuerbeträge abzusetzen**, soweit über sie Rechnungen mit gesondertem Steuerausweis erteilt wurden. |
| Abschn. 14.8 UStAE | Verwaltungsauffassung zu § 14 Abs. 5 UStG: konkretisiert Form/Inhalt der Absetzung in der Endrechnung (Bezeichnung der Anzahlungsrechnungen nach Datum und Betrag) und die Folgen einer fehlerhaften/unterlassenen Absetzung (Gefährdung nach § 14c Abs. 1 UStG bei zu hohem Steuerausweis in der Endrechnung). |

### Umsetzung in dieser Software

- **Drei Rechnungstypen, alle GoBD-Rechnungen** (Entwurf → `finalizeWithinTx` → Storno/Gutschrift wie jede andere Rechnung): `PARTIAL` (Teilrechnung über eine Teilleistung — Leistung ist bereits erbracht, keine Anzahlungsbesteuerung), `DOWNPAYMENT` (Abschlagsrechnung vor Leistungserbringung — löst § 13 Abs. 1 Nr. 1 Buchst. a Satz 4 UStG aus), `FINAL` (Schlussrechnung über die Gesamtleistung mit Absetzung).
- **Abzugs-Snapshot (`FinalInvoiceDeduction`):** beim Festschreiben einer Schlussrechnung werden alle festgeschriebenen, nicht stornierten Abschlagsrechnungen der Quelle geladen, ihre Netto-/Steuerbeträge je Steuersatz in unveränderlichen `FinalInvoiceDeduction`-Zeilen gesichert (`number`/`issueDate` der jeweiligen Abschlagsrechnung — die von Abschn. 14.8 UStAE geforderte Bezeichnung nach Datum und Betrag) und `prepaidCents`/`payableCents` auf der Schlussrechnung gesetzt. Ein zu hoher Abzug (Summe der Abschläge > Gesamtleistung) wird beim Festschreiben mit Fehler abgelehnt statt einen negativen Restbetrag zuzulassen.
- **E-Rechnung (EN 16931 / KoSIT-Empfehlung „Schlussrechnung"):** `DOWNPAYMENT` → `InvoiceTypeCode`/`TypeCode` **386** (UNTDID 1001 „**Prepayment invoice**" — Anzahlungsrechnung; korrigiert in der Fix-Welle nach dem Abschluss-Review, B10: zuvor fälschlich als „Partial invoice" bezeichnet, das ist Code **326**); `PARTIAL`/`FINAL` bleiben **380**. `PARTIAL` nutzt bewusst 380 statt des an sich passenderen 326 („Partial invoice"): 326 ist im XRechnung-/KoSIT-Umfeld unüblich und wird von Pruef-/Buchhaltungssoftware selten unterstützt, während 380 mit einem erläuternden Freitext (Beschreibung „Teilleistung … zu <Quelle Nr.>") ausreicht, um die Teilrechnung eindeutig zu kennzeichnen. Auf der Schlussrechnung: **BT-113** (Paid amount) = Σ Abschläge **brutto** aus dem Snapshot (nicht die tatsächlich geleisteten Zahlungen — das ist die von der KoSIT-Empfehlung vorgegebene Lesart von „Prepaid amount" bei Abschlagsrechnungen; Zahlungen, die NACH der Festschreibung der Schlussrechnung eingehen, ändern BT-113 nicht mehr, weil die XML zum Festschreibungszeitpunkt erzeugt wird — praktisch unschädlich, aber siehe `src/lib/einvoice/mapper.ts`), **BT-115** (Amount due for payment) = Restbetrag, **BG-3** (`cac:BillingReference`/`ram:InvoiceReferencedDocument`) je Abschlagsrechnung mit BT-25 (Nummer) und BT-26 (Datum), zusätzlich ein **BT-22**-Freitext mit der Abzugsaufstellung (Netto/USt je Abschlag). **EN 16931 BR-CO-16** (Payable amount = Tax inclusive amount − Paid amount, ggf. + Rundungsbetrag) ist dadurch automatisch erfüllt, weil `payableCents = grossTotalCents − paidCents` als einzige Formel für alle Rechnungstypen gilt.
- **PDF-Abschlagsrechnung:** Pflichthinweis „Anzahlung, Steuer wird mit Vereinnahmung geschuldet (§ 13 Abs. 1 Nr. 1 Buchst. a Satz 4 UStG)."
- **PDF-Schlussrechnung:** Summenblock zeigt „Gesamtleistung netto/brutto", je Abzug eine Zeile „abzüglich Abschlagsrechnung … − x,xx € (enthaltene USt y,yy €)", danach fett den Restbetrag — spiegelt Abschn. 14.8 UStAE unmittelbar auf dem Beleg.

### Grenzen dieser Umsetzung

Siehe `docs/LIMITATIONEN.md` — insbesondere: kein Mischen von Teil- und Abschlagsrechnungen auf derselben Quelle, Storno einer Abschlagsrechnung nach bereits festgeschriebener Schlussrechnung erfordert manuelles Nacharbeiten (keine automatische Korrektur der Schlussrechnung), Skonto wirkt nur auf den Restbetrag der Schlussrechnung.

**Quellen:** [§ 13 Abs. 1 Nr. 1 Buchst. a UStG](https://www.gesetze-im-internet.de/ustg_1980/__13.html) · [§ 14 Abs. 5 UStG](https://www.gesetze-im-internet.de/ustg_1980/__14.html) · [Abschn. 14.8 UStAE (NWB-Datenbank)](https://datenbank.nwb.de/Dokument/378652_14___5/) · [xeinkauf.de — XRechnung FAQ](https://xeinkauf.de/xrechnung/) · [ZUGFeRD-Spezifikation — Schlussrechnung/KoSIT-Empfehlung](https://www.ferd-net.de/zugferd/)
**Stand:** 2026-09-04

---

## 15. UMSETZUNGS-MATRIX — Software-Pflichten

| Anforderung | Konkrete Software-Pflicht (Feld / Validierung / Sperre / Default) | MVP / Später |
|-------------|---------------------------------------------------------------------|--------------|
| § 14 Abs. 4: 10 Pflichtangaben | Felder erzwingen; **Validierung** vor Finalisieren (alle 10 vorhanden, außer reduzierte Sonderfälle) | **MVP** |
| Fortlaufende, einmalige Rechnungsnummer | **Unique-Constraint** in DB; Nummernkreis-Konfig (pro Jahr/Mandant/Filiale); **keine** erzwungene gap-free Sequenz; Lücken/Stornos protokollieren | **MVP** |
| Rechnungsdatum / Leistungsdatum | Pflichtfelder; Default Leistungsdatum = Kalendermonat erlaubt | **MVP** |
| Steuersatz/-betrag aufgeschlüsselt | nach Steuersätzen gruppieren; Brutto = Netto + Σ Steuer; Rundungs-Validierung | **MVP** |
| Kleinbetragsrechnung ≤ 250 € brutto | **Schwellen-Check** (brutto!); reduziertes Template; § 33-Ausschlüsse (§ 3c/§ 6a/§ 13b) **sperren** | **MVP** |
| Kleinunternehmer-Modus (§ 19/§ 34a) | **HARTE SPERRE:** kein USt-Betrag/Steuersatz erzeugbar; Pflicht-Hinweis-Text automatisch einfügen; Netto=Brutto-Schwellen 25.000/100.000 € | **MVP** |
| Schwellen-Monitoring § 19 (100.000 €) | laufende Umsatzsumme tracken; **Warnung/Sofort-Umschaltung** bei Überschreiten (auch unterjährig) | **Später** |
| Reverse Charge (§ 13b) | bei Markierung: USt-Ausweis **sperren**, Pflichthinweis „Steuerschuldnerschaft des Leistungsempfängers" + USt-IdNr. beider erzwingen | **MVP** |
| Differenzbesteuerung (§ 25a) | **HARTE SPERRE** gegen USt-Ausweis; Pflichthinweis „Gebrauchtgegenstände/Sonderregelung"; Brutto-VK als Entgelt; getrennte Margen-Aufzeichnung | **MVP** (Refurb-Geschäftsmodell) |
| § 14a-Hinweise (ig. Lieferung/Leistung) | fallabhängig USt-IdNr. beider + Befreiungs-/RC-Hinweis; **15-Tage-Ausstellfrist** anzeigen | **Später** |
| USt-IdNr.-Prüfung (VIES/§ 18e) | **qualifizierte** Bestätigungsanfrage ans BZSt; Prüfprotokoll speichern; Re-Check-Intervall | **Später** |
| Zusammenfassende Meldung (§ 18a) | ZM-Datensatz erzeugen; Frist 25. d. Folgemonats; Quartals-/Monats-Logik (50.000-€-Schwelle); Berichtigung ≤ 1 Monat | **Später** |
| E-Rechnung erzeugen (EN 16931) | XRechnung/ZUGFeRD ab Profil **BASIC**; **Profil-Sperre** gegen MINIMUM/BASIC-WL; Pflichtangaben **maschinenlesbar** im XML | **MVP** (B2B) / **Später** (Refurb-B2C) |
| E-Rechnung validieren | **KoSIT-Validator** (HTTP-Daemon) + **veraPDF** (PDF/A-3) nachschalten; reine JS-Validierung **nicht** ausreichend | **MVP** (wenn B2B) |
| E-Rechnung empfangen | Empfangskanal (E-Mail-Postfach + XML-Parser); Pflicht seit 1.1.2025 | **MVP** |
| Hybrid-E-Rechnung | strukturierter XML-Teil **führend**; bei Abweichung XML maßgebend; Bildteil nur bei steuerlich relevanter Abweichung archivieren | **Später** |
| Leitweg-ID (B2G) | BT-10-Feld; **Mod-97-10-Prüfziffer-Validierung**; vom Auftraggeber übernommen (nicht generiert); im B2B leer | **Später** (nur bei B2G) |
| Skonto in E-Rechnung | Freitext BT-20 „X % Skonto bei Zahlung bis …" + strukturierte `#SKONTO#TAGE=n#PROZENT=x.xx#`-Zeile je Ziel (bis zu zwei Ziele); **kein** betragsmäßiger Ausweis nötig; spätere Skonto-Zahlung = § 17, **keine** Korrekturrechnung | **MVP** |
| Rabatt/Aufschlag in E-Rechnung | `AllowanceCharge` je Position (BG-27/28) und je Steuersatz auf Dokumentebene (BG-20/21, Largest-Remainder-Aufteilung); vorzeichen-invariant für Storno/Gutschrift; BT-107/108-Summenfelder | **MVP** |
| Storno/Korrektur | eindeutiger Bezug zur Ursprungsrechnung (Datum + Nr.); bei E-Rechnung **als E-Rechnung** im Storno-/Korrektur-Rechnungstyp (PDF/Papier **gesperrt**) | **MVP** |
| Gutschrift (echte, § 14 Abs. 2 S. 5) | „Gutschrift"-Kennzeichnung über Rechnungstyp; vorherige Vereinbarung; B2B-Inland E-Rechnung; Widerspruchs-Status | **Später** |
| § 14c-Schutz | UI verhindert versehentlichen USt-Ausweis in RC-/§25a-/Kleinunternehmer-Belegen | **MVP** |
| Unveränderbarkeit (GoBD) | **Festschreibung/Lock** nach Finalisieren; **Audit-Log/Versionierung** jeder Änderung; **kein** Hard-Edit festgeschriebener Belege | **MVP** |
| Aufbewahrung 8 Jahre + Ablaufhemmung | strukturiertes XML revisionssicher 8 J.; **kein** Auto-Hard-Delete; offene Festsetzung/Bp verlängert → manueller Freigabe-Schritt vor Löschung | **MVP** |
| GoBD-Verfahrensdokumentation | Export/Vorlage zur Anwender-Verfahrensdoku bereitstellen (Software liefert sie nicht automatisch) | **Später** |
| DSGVO Löschung vs. Aufbewahrung | **Soft-Delete/Archiv-Flag** bei rechnungsrelevanten Daten; Hard-Delete blockieren bis Fristablauf; AVV-Hinweis bei Hosting | **MVP** |
| Mahnwesen Verzug/Zinsen | **Verbraucher-Flag** pro Schuldner steuert: 5/9 Pp, 40-€-Pauschale (nur B2B), Pflicht-30-Tage-Hinweis (B2C); Basiszins halbjahresgenau (1,27 % H1 2026) | **Später** |
| Mahngebühren | erste Mahnung **kostenfrei** (Zahlungserinnerung), Mahnkosten erst ab 2. Mahnung; nur konkrete Porto-/Materialkosten | **Später** |
| OSS (B2C EU) | Bestimmungsland-Steuersatz; 10.000-€-EU-Schwelle; Quartals-Erklärung; Rechnungspflicht entfällt bei OSS-Teilnahme | **Später** (nur bei EU-B2C-Fernverkauf) |

---

## 16. Offene rechtliche Fragen — vor Produktivnutzung mit Steuerberater klären

1. **Geschäftsmodell B2B vs. B2C?** Davon hängt ab, ob XRechnung/ZUGFeRD-Erzeugung überhaupt implementiert werden muss (E-Rechnungspflicht nur B2B).
2. **Vorjahresumsatz über/unter 800.000 €?** Bestimmt, ob die Ausstellungspflicht ab 1.1.2027 oder erst 1.1.2028 greift.
3. **Nummernkreis-Logik:** einzelner Kreis oder mehrere (Jahr/Mandant/Filiale)? Beides zulässig — Einmaligkeit muss systemseitig garantiert sein.
4. **EN-16931-Mapping der Sonderhinweise** (Reverse Charge, § 25a, Steuerbefreiung) auf VAT-Category-Codes/BT-120/BT-121 — gegen aktuelle KoSIT/XRechnung-Spezifikation verifizieren. **[ungesichert]**
5. **§ 14c-Endverbraucher-Ausnahme** (EuGH C-378/21, BMF 27.02.2024) im Kleinunternehmer-/§-25a-Kontext — Reichweite einzelfallbezogen absichern. **[ungesichert]**
6. **GoBD-Zertifizierbarkeit** (IDW PS 880 / WP-Testat) gewünscht, oder reicht GoBD-Konformität mit Muster-Verfahrensdokumentation?
7. **Kassen-/Bargeschäft** (§ 146a AO, KassenSichV, TSE-Pflicht, DSFinV-K) im Scope? Falls ja: zusätzliche, hier nicht recherchierte Anforderungen.
8. **OSS-Registrierungswirksamkeit** und Zusammenspiel mit EU-Kleinunternehmerregelung (§ 19a) — am BZSt/BMF-Primärtext verifizieren. **[ungesichert]**
9. **Länder-B2G-Pflichten** (Stichtage/Schwellen/Leitweg-ID je Bundesland) — vor konkretem B2G-Mandat die Landes-VO prüfen. **[ungesichert]**
10. **KoSIT-Leitweg-ID-Formatspezifikation:** Ist v2.0.2 (28.07.2021) noch geltend, oder gibt es eine 2025/2026-Fassung? Mod-97-10-Eingabestring für eigene Prüffunktion final verifizieren.
11. **Ablaufhemmung der 8-Jahres-Frist** im konkreten Fall (§ 147 Abs. 3 S. 5 AO) — pro Datensatz ggf. > 8 Jahre vorhalten.
12. **AVV/Transfer** (Art. 28, Art. 44 ff. DSGVO) für konkrete Hosting-/Backup-/Monitoring-Dienstleister, inkl. Drittlandbezug.
13. **Exakte Fundstellen** der maßgeblichen BMF-Schreiben (15.10.2025 E-Rechnung; 18.03.2025 Kleinunternehmer; 25.10.2013 Gutschrift/§ 14c; GoBD-2.-Änderung 14.07.2025) für rechtsverbindliche Mandanten-/Produkt-Aussagen direkt aus den BMF-PDFs zitieren.

---

## 17. Quellenverzeichnis

### Gesetze (gesetze-im-internet.de / dejure.org)

- § 3a UStG — https://www.gesetze-im-internet.de/ustg_1980/__3a.html
- § 3c UStG — https://www.gesetze-im-internet.de/ustg_1980/__3c.html
- § 4 UStG — https://www.gesetze-im-internet.de/ustg_1980/__4.html
- § 6a UStG — https://www.gesetze-im-internet.de/ustg_1980/__6a.html
- § 13 UStG — https://www.gesetze-im-internet.de/ustg_1980/__13.html
- § 13b UStG — https://www.gesetze-im-internet.de/ustg_1980/__13b.html
- § 14 UStG — https://www.gesetze-im-internet.de/ustg_1980/__14.html
- § 14 UStG (dejure, konsolidiert) — https://dejure.org/gesetze/UStG/14.html
- § 14a UStG — https://www.gesetze-im-internet.de/ustg_1980/__14a.html
- § 14b UStG — https://www.gesetze-im-internet.de/ustg_1980/__14b.html
- § 14c UStG — https://www.gesetze-im-internet.de/ustg_1980/__14c.html
- § 18a UStG — https://www.gesetze-im-internet.de/ustg_1980/__18a.html
- § 18j UStG — https://www.gesetze-im-internet.de/ustg_1980/__18j.html
- § 19 UStG — https://www.gesetze-im-internet.de/ustg_1980/__19.html
- § 19a UStG — https://www.gesetze-im-internet.de/ustg_1980/__19a.html
- § 25a UStG — https://www.gesetze-im-internet.de/ustg_1980/__25a.html
- § 27 UStG — https://www.gesetze-im-internet.de/ustg_1980/__27.html
- § 31 UStDV — https://www.gesetze-im-internet.de/ustdv_1980/__31.html
- § 33 UStDV — https://www.gesetze-im-internet.de/ustdv_1980/__33.html
- § 34 UStDV — https://www.gesetze-im-internet.de/ustdv_1980/__34.html
- § 34a UStDV — https://www.gesetze-im-internet.de/ustdv_1980/__34a.html
- § 146 AO — https://www.gesetze-im-internet.de/ao_1977/__146.html
- § 147 AO — https://www.gesetze-im-internet.de/ao_1977/__147.html
- § 257 HGB — https://www.gesetze-im-internet.de/hgb/__257.html
- § 286 BGB — https://www.gesetze-im-internet.de/bgb/__286.html
- § 288 BGB — https://www.gesetze-im-internet.de/bgb/__288.html
- § 288 BGB (dejure, Abs. 6 Volltext) — https://dejure.org/gesetze/BGB/288.html
- ERechV — https://www.gesetze-im-internet.de/erechv/BJNR355500017.html
- § 4 ERechV — https://www.gesetze-im-internet.de/erechv/__4.html
- § 5 ERechV — https://www.gesetze-im-internet.de/erechv/__5.html
- UStAE 14.5 (NWB-Datenbank) — https://datenbank.nwb.de/Dokument/378652_14___5/
- Art. 97 § 19a EGAO (buzer.de) — https://www.buzer.de/gesetz/1652/al233399-0.htm
- § 14c-Fassungshinweis (buzer.de) — https://www.buzer.de/gesetz/5509/al208617-0.htm

### BMF / Behörden

- BMF-FAQ E-Rechnung — https://www.bundesfinanzministerium.de/Content/DE/FAQ/e-rechnung.html
- BMF-Schreiben 15.10.2025 obligatorische E-Rechnung (HTML) — https://www.bundesfinanzministerium.de/Content/DE/Downloads/BMF_Schreiben/Steuerarten/Umsatzsteuer/Umsatzsteuer-Anwendungserlass/2025-10-15-einfuehrung-obligatorische-e-rechnung.html
- BMF-Schreiben 15.10.2025 (PDF) — https://www.bundesfinanzministerium.de/Content/DE/Downloads/BMF_Schreiben/Steuerarten/Umsatzsteuer/Umsatzsteuer-Anwendungserlass/2025-10-15-einfuehrung-obligatorische-e-rechnung.pdf
- BMF-Schreiben 18.03.2025 Kleinunternehmer (PDF) — https://www.bundesfinanzministerium.de/Content/DE/Downloads/BMF_Schreiben/Steuerarten/Umsatzsteuer/Umsatzsteuer-Anwendungserlass/2025-03-18-sonderregelung-kleinunternehmer.pdf
- BMF GoBD 2. Änderung 14.07.2025 (HTML) — https://www.bundesfinanzministerium.de/Content/DE/Downloads/BMF_Schreiben/Weitere_Steuerthemen/Abgabenordnung/2025-07-14-GoBD-2-aenderung.html
- BMF GoBD 2. Änderung 14.07.2025 (PDF) — https://www.bundesfinanzministerium.de/Content/DE/Downloads/BMF_Schreiben/Weitere_Steuerthemen/Abgabenordnung/2025-07-14-GoBD-2-aenderung.pdf
- BZSt — Bestätigung ausländischer USt-IdNr. — https://www.bzst.de/DE/Unternehmen/Identifikationsnummern/Umsatzsteuer-Identifikationsnummer/AuslaendischeUSt-IdNr/auslaendische_ust_idnr_node.html
- BZSt — One-Stop-Shop EU — https://www.bzst.de/DE/Unternehmen/Umsatzsteuer/One-Stop-Shop_EU/one_stop_shop_eu_node.html
- Deutsche Bundesbank — Basiszinssatz 01.01.2026 — https://www.bundesbank.de/de/presse/pressenotizen/bekanntgabe-des-basiszinssatzes-zum-1-januar-2026-basiszinssatz-bleibt-unveraendert-bei-1-27--973974
- BGBl. 2024 I Nr. 323 (BEG IV) — https://www.recht.bund.de/bgbl/1/2024/323/regelungstext.pdf?__blob=publicationFile&v=3

### B2G / Leitweg-ID

- KoSIT Leitweg-ID Formatspezifikation v2.0.2 — https://leitweg-id.de/wp-content/uploads/2021/08/Leitweg-ID-Formatspezifikation-v2-0-2.pdf
- e-rechnung-bund.de — Buyer Reference Aufbau — https://e-rechnung-bund.de/en/faq/how-is-a-buyer-reference-structured/
- e-rechnung-bund.de — Plattform-Konsolidierung 19.09.2025 — https://e-rechnung-bund.de/en/successful-platform-consolidation/
- e-rechnung-bund.de — Peppol — https://e-rechnung-bund.de/en/transmission-methods/peppol/
- leitweg-id.de — BT-10 Buyer Reference — https://leitweg-id.de/en/buyer-reference-bt-10/

### EU-Recht / DSGVO

- DSGVO (EUR-Lex, CELEX:32016R0679) — https://eur-lex.europa.eu/legal-content/DE/TXT/HTML/?uri=CELEX:32016R0679

### Rechtsprechung

- BGH 26.06.2019, VIII ZR 95/18 (Mahngebühren) — https://dejure.org/dienste/vernetzung/rechtsprechung?Gericht=BGH&Datum=26.06.2019&Aktenzeichen=VIII+ZR+95/18
- BAG 25.09.2018, 8 AZR 26/18 (40-€-Pauschale Arbeitsrecht) — https://dejure.org/dienste/vernetzung/rechtsprechung?Gericht=BAG&Datum=25.09.2018&Aktenzeichen=8+AZR+26/18
- EuGH 01.12.2022, C-419/21 (40-€-Pauschale je Forderung) — https://dejure.org/dienste/vernetzung/rechtsprechung?Gericht=EuGH&Datum=01.12.2022&Aktenzeichen=C-419%2F21

### Fachquellen / Sekundärliteratur (zur Einordnung, nicht rechtsverbindlich)

- HK Hamburg — Pflichtangaben Rechnungen — https://www.handelskammer-hamburg.de/recht-steuern/steuerrecht/umsatzsteuer-mehrwertsteuer/umsatzsteuer-mehrwertsteuer-national/umsatzsteuer-pflichtangaben-rechnungen-6680494
- HK Hamburg — Differenzbesteuerung — https://www.handelskammer-hamburg.de/recht-steuern/steuerrecht/umsatzsteuer-mehrwertsteuer/umsatzsteuer-mehrwertsteuer-national/differenzbesteuerung-gebrauchtwarenhandel-6680498
- Haufe — BMF-Schreiben E-Rechnung — https://www.haufe.de/finance/buchfuehrung-kontierung/bmf-schreiben-e-rechnung_186_634646.html
- Haufe — GoBD zeitnahe Aufzeichnungen — https://www.haufe.de/steuern/finanzverwaltung/neufassung-der-gobd-kommentierung/gobd-vollstaendige-und-zeitnahe-aufzeichnungen_164_496516.html
- Haufe — Gutschrift/§ 14c — https://www.haufe.de/finance/buchfuehrung-kontierung/aus-der-praxis-begriff-gutschrift-bei-rechnungen_186_368350.html
- Haufe — fortlaufende Nummerierung Ausnahmen — https://www.haufe.de/finance/buchfuehrung-kontierung/fortlaufende-nummerierung-von-rechnungen-ausnahmen_186_387400.html
- BStBK — GoBD-Praxisleitfaden — https://www.bstbk.de/downloads/bstbk/steuerrecht-und-rechnungslegung/fachinfos/BStBK_GoBD_Ein-Praxisleitfaden-fuer-Unternehmen.pdf
- IHK München — GoBD — https://www.ihk-muenchen.de/ratgeber/steuern/finanzverwaltung/grundsaetze-elektronische-buchfuehrung-gobd/
- IHK Köln — Aufbewahrung Geschäftsunterlagen — https://www.ihk.de/koeln/hauptnavigation/recht-steuern/steuern/aufbewahrung-von-geschaeftsunterlagen-5905058
- Deloitte — BEG IV — https://www.deloitte-tax-news.de/steuern/verfahrensrecht/buerokratieentlastungsgesetz-iv-bundestag-verabschiedet-gesetz.html
- EY — längere Aufbewahrung Banken/Versicherungen — https://www.ey.com/de_de/technical/steuernachrichten/laengere-aufbewahrungsfristen-bei-banken-versicherungen-und-wertpapierinstituten
- e-recht24 — Webhoster & Datenschutz/AVV — https://www.e-recht24.de/datenschutz/13053-webhoster-und-datenschutz.html
- dr-datenschutz — Löschpflicht & Verjährungsfristen — https://www.dr-datenschutz.de/loeschpflicht-und-verjaehrungsfristen/
- LKC — EuGH 40-€-Verzugspauschale — https://lkc.de/eugh-schafft-klarheit-zur-40-euro-verzugspauschale/
- Finanztip — Mahngebühren — https://www.finanztip.de/mahngebuehren/
- xeinkauf.de — XRechnung FAQ (Abschlags-/Schlussrechnung, BT-113/BG-3) — https://xeinkauf.de/xrechnung/
- ZUGFeRD-Spezifikation / KoSIT-Empfehlung „Schlussrechnung" — https://www.ferd-net.de/zugferd/

### Tooling (außerhalb des primärquellen-verifizierten Rechts-Scopes)

- Mustangproject — https://github.com/ZUGFeRD/mustangproject/
- horstoeko/zugferd — https://github.com/horstoeko/zugferd
- node-zugferd — https://github.com/jslno/node-zugferd
- KoSIT-Validator — https://github.com/itplr-kosit/validator
- veraPDF / ZUV — https://github.com/ZUGFeRD/ZUV

---

*Ende COMPLIANCE.md — Stand 2026-06-09. Ohne Gewähr. Keine Steuer-/Rechtsberatung.*
