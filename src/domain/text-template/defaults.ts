/**
 * Neutrale deutsche Standard-Dokumenttexte je (docType, position). Werden bei Anlage
 * eines Belegs vorbelegt (src/domain/document/create.ts, src/domain/delivery-note/create.ts,
 * src/domain/document/convert.ts), wenn kein eigener Text angegeben ist — der Text wird
 * als Snapshot am Beleg gespeichert, kein Live-Bezug auf die Vorlage.
 */
export const DEFAULT_TEXT_TEMPLATES = [
  { docType: "ANGEBOT", position: "HEAD", name: "Standard", body: "Vielen Dank für Ihre Anfrage. Gerne unterbreiten wir Ihnen folgendes Angebot:" },
  { docType: "ANGEBOT", position: "FOOT", name: "Standard", body: "Dieses Angebot ist gültig bis {{offer.validUntil}}. Wir freuen uns auf Ihren Auftrag." },
  { docType: "ANGEBOT", position: "TERMS_DELIVERY", name: "Standard", body: "Lieferung nach Vereinbarung." },
  { docType: "ANGEBOT", position: "TERMS_PAYMENT", name: "Standard", body: "Zahlbar innerhalb von 14 Tagen ohne Abzug." },
  { docType: "AUFTRAGSBESTAETIGUNG", position: "HEAD", name: "Standard", body: "Vielen Dank für Ihren Auftrag. Hiermit bestätigen wir:" },
  { docType: "AUFTRAGSBESTAETIGUNG", position: "FOOT", name: "Standard", body: "Wir werden den Auftrag wie vereinbart ausführen." },
  { docType: "DELIVERY_NOTE", position: "HEAD", name: "Standard", body: "Wir liefern Ihnen hiermit folgende Positionen:" },
  { docType: "DELIVERY_NOTE", position: "FOOT", name: "Standard", body: "Bitte prüfen Sie die Lieferung auf Vollständigkeit." },
  { docType: "INVOICE", position: "HEAD", name: "Standard", body: "Wir erlauben uns, folgende Leistungen in Rechnung zu stellen:" },
  { docType: "INVOICE", position: "FOOT", name: "Standard", body: "Vielen Dank für Ihren Auftrag." },
] as const;
