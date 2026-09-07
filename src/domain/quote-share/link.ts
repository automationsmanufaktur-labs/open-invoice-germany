/**
 * Angebotslinks (Phase 3b, Task 2): erzeugen, widerrufen, auflösen, auflisten. Das
 * Klartext-Token existiert ausschliesslich in der Antwort von `createShareLink` — die
 * Datenbank haelt nur den SHA-256-Hash (`QuoteShareLink.tokenHash`, `@unique`). Die
 * Auflösung (`resolveShareToken`) liefert nach aussen fuer JEDEN ungueltigen Fall
 * (unbekannt, widerrufen, abgelaufen, Angebot archiviert/storniert) einheitlich `null` —
 * keine Unterscheidung, die einem Angreifer verraet, welcher Fall vorliegt.
 */
import { dbInternal } from "@/lib/db";
import { appendChangeLog } from "@/domain/audit";
import { logActivity } from "@/domain/activity/log";
import { NotFoundError } from "@/domain/errors";
import { generateToken, hashToken } from "@/domain/quote-share/token";
import { effectiveQuoteStatus } from "@/domain/document/status";
import { loadDocumentSettings } from "@/domain/document/settings";
import { createShareLinkInputSchema } from "@/schemas/quote-share";
import { encryptSecret, decryptSecret } from "@/lib/crypto/secrets";
import type { QuoteShareLink } from "@/generated/prisma/client";

export class ShareLinkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShareLinkError";
  }
}

interface ShareLinkOptions {
  actor?: string;
  now?: Date;
}

// Ruling (Task-2-Addendum): DRAFT ist als Quellstatus erlaubt (Postversand, telefonische
// Ankuendigung o.ae.) — die Link-Erzeugung selbst setzt das Angebot NICHT auf SENT, das
// macht ausschliesslich der Mailversand oder eine manuelle Aktion.
const CREATE_ALLOWED_STATUS = new Set(["DRAFT", "SENT", "EXPIRED"]);

/**
 * Erzeugt einen Annahme-Link fuer ein Angebot (kind === "ANGEBOT"). `expiresAt` ist das
 * Minimum aus `validUntil` (falls gesetzt) und `now + expiresInDays` (Eingabe oder
 * DocumentSettings.shareLinkDays) — ein Link darf ein bereits abgelaufenes Angebot nicht
 * ueberleben. Gibt `{ link, token }` zurueck; der Klartext-Token wird NIE gespeichert.
 */
export async function createShareLink(
  orgId: string,
  quoteId: string,
  rawInput: unknown = {},
  opts: ShareLinkOptions = {},
): Promise<{ link: QuoteShareLink; token: string }> {
  const input = createShareLinkInputSchema.parse(rawInput ?? {});
  const now = opts.now ?? new Date();
  const actor = opts.actor ?? "system";

  const quote = await dbInternal.quote.findFirst({ where: { id: quoteId, orgId } });
  if (!quote) throw new NotFoundError(`Angebot ${quoteId} nicht gefunden.`);
  if (quote.kind !== "ANGEBOT") {
    throw new ShareLinkError("Annahme-Links koennen nur fuer Angebote (kind=ANGEBOT) erzeugt werden.");
  }

  const eff = effectiveQuoteStatus({ status: quote.status, validUntil: quote.validUntil }, now);
  if (!CREATE_ALLOWED_STATUS.has(eff)) {
    throw new ShareLinkError(`Angebot im Status "${eff}" kann keinen Annahme-Link erhalten.`);
  }

  const settings = await loadDocumentSettings(orgId);
  const days = input.expiresInDays ?? settings.shareLinkDays;
  const byDuration = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  const expiresAt = quote.validUntil && quote.validUntil.getTime() < byDuration.getTime() ? quote.validUntil : byDuration;

  const token = generateToken();
  const tokenHash = hashToken(token);
  // Wirft SecretsUnavailableError, wenn AUTH_SECRET fehlt/zu kurz ist — VOR jedem
  // Schreibvorgang, damit ohne funktionierende Verschluesselung kein Link entsteht
  // (Adjudikation Task-1: Token muss fuer den spaeteren Betreiber-Wiederabruf
  // verschluesselt gespeichert werden koennen).
  const tokenEnc = encryptSecret(token);

  const link = await dbInternal.$transaction(async (tx) => {
    const created = await tx.quoteShareLink.create({
      data: { orgId, quoteId, tokenHash, tokenEnc, expiresAt, createdBy: actor },
    });
    await appendChangeLog(tx, {
      orgId,
      entity: "QUOTE",
      entityId: quoteId,
      action: "SHARE_LINK_CREATED",
      actor,
      at: now,
      diff: { linkId: created.id, expiresAt: expiresAt.toISOString() },
    });
    await logActivity(tx, { orgId, entityType: "QUOTE", entityId: quoteId, type: "SHARE_LINK_CREATED", actor, at: now, data: { linkId: created.id } });
    return created;
  });

  return { link, token };
}

/** Widerruft einen Angebotslink (setzt `revokedAt`); ab dann liefert `resolveShareToken` `null`. */
export async function revokeShareLink(orgId: string, linkId: string, opts: ShareLinkOptions = {}): Promise<QuoteShareLink> {
  const now = opts.now ?? new Date();
  const actor = opts.actor ?? "system";

  return dbInternal.$transaction(async (tx) => {
    const link = await tx.quoteShareLink.findFirst({ where: { id: linkId, orgId } });
    if (!link) throw new NotFoundError(`Angebotslink ${linkId} nicht gefunden.`);

    const updated = await tx.quoteShareLink.update({ where: { id: linkId }, data: { revokedAt: now } });
    await appendChangeLog(tx, {
      orgId,
      entity: "QUOTE",
      entityId: link.quoteId,
      action: "SHARE_LINK_REVOKED",
      actor,
      at: now,
      diff: { linkId },
    });
    return updated;
  });
}

/**
 * Entschluesselt den Klartext-Token eines bestehenden Links fuer den Betreiber
 * (authentifizierter, org-gepruefter Pfad — z. B. `GET
 * /api/documents/[id]/share-links/[linkId]/token`, `prefillEmail`). NIE in
 * `/api/public/` oder `resolveShareToken`/`resolveShareLinkForDecision` verwenden —
 * die oeffentlichen Pfade duerfen ausschliesslich ueber den Hash aufloesen. Liefert
 * `null`, wenn der Link unbekannt ist, kein `tokenEnc` gespeichert wurde (Alt-Link vor
 * dieser Aenderung) oder die Entschluesselung fehlschlaegt (z. B. AUTH_SECRET rotiert).
 */
export async function revealShareLinkToken(orgId: string, linkId: string): Promise<string | null> {
  const link = await dbInternal.quoteShareLink.findFirst({ where: { id: linkId, orgId }, select: { tokenEnc: true } });
  if (!link?.tokenEnc) return null;
  try {
    return decryptSecret(link.tokenEnc);
  } catch {
    return null;
  }
}

/** Alle Angebotslinks eines Angebots (Mandantenpruefung ueber das Angebot). */
export async function listShareLinks(orgId: string, quoteId: string): Promise<QuoteShareLink[]> {
  const quote = await dbInternal.quote.findFirst({ where: { id: quoteId, orgId }, select: { id: true } });
  if (!quote) throw new NotFoundError(`Angebot ${quoteId} nicht gefunden.`);
  return dbInternal.quoteShareLink.findMany({ where: { orgId, quoteId }, orderBy: { createdAt: "desc" } });
}

/**
 * Prueft rein lesend, ob ein QuoteShareLink (bereits per tokenHash geladen) noch gueltig
 * ist — unbekannt (Aufrufer prueft `link !== null` vorher), widerrufen, abgelaufen, oder
 * das zugehoerige Angebot archiviert/storniert. Gemeinsame Kernpruefung fuer
 * `resolveShareToken` (oeffentliche Auflösung) und `decideOffer` (Online-Entscheidung) —
 * beide duerfen nach aussen keinen Unterschied zwischen den Ungueltigkeitsgruenden zeigen.
 */
function isLinkCurrentlyValid(
  link: { revokedAt: Date | null; expiresAt: Date; decidedAt: Date | null },
  quote: { archivedAt: Date | null; status: string; validUntil: Date | null },
  now: Date,
): boolean {
  if (link.revokedAt) return false;
  if (link.expiresAt.getTime() < now.getTime()) return false;
  if (quote.archivedAt) return false;
  if (quote.status === "CANCELLED") return false;
  // G2: Der Effektivstatus (inkl. abgeleitetem EXPIRED aus validUntil) muss weiterhin
  // annahmefaehig sein. Bereits entschiedene Links (decidedAt gesetzt) sind davon
  // ausgenommen — die Seite soll dann "bereits entschieden" zeigen, kein 404, auch wenn
  // das Angebot inzwischen z. B. ACCEPTED ist.
  if (!link.decidedAt) {
    const eff = effectiveQuoteStatus({ status: quote.status, validUntil: quote.validUntil }, now);
    if (eff !== "DRAFT" && eff !== "SENT" && eff !== "EXPIRED") return false;
  }
  return true;
}

export type ResolvedQuote = NonNullable<Awaited<ReturnType<typeof loadQuoteForShare>>>;

async function loadQuoteForShare(quoteId: string) {
  return dbInternal.quote.findFirst({
    where: { id: quoteId },
    include: {
      lines: { orderBy: { position: "asc" } },
      org: true,
      customer: true,
    },
  });
}

export interface ResolvedShareLink {
  link: QuoteShareLink;
  quote: ResolvedQuote;
}

/**
 * Loest ein Klartext-Token auf (Hash-Lookup — die Klartextsuche in der DB ist unmoeglich,
 * es wird nur `tokenHash` gespeichert). Liefert `null` fuer JEDEN Ungueltigkeitsfall
 * (unbekannt, widerrufen, abgelaufen, Angebot archiviert/storniert) — nach aussen nicht
 * unterscheidbar. Bei Gueltigkeit werden `viewCount`/`lastViewedAt` gezaehlt (reiner
 * Lesezugriff, daher bewusst OHNE ChangeLog-Eintrag).
 */
// W4: dieselbe Seitenanfrage feuert mehrfach (PDF-Link, Reload, Prefetch) — ohne
// Drosselung waechst viewCount pro Besuch beliebig. Ein Zaehl-Update pro Link hoechstens
// alle 60s reicht als grobe "Aufrufe"-Anzeige im Betreiber-Panel.
const VIEW_COUNT_THROTTLE_MS = 60_000;

export async function resolveShareToken(token: string, now: Date = new Date()): Promise<ResolvedShareLink | null> {
  const tokenHash = hashToken(token);
  const link = await dbInternal.quoteShareLink.findFirst({ where: { tokenHash } });
  if (!link) return null;

  const quote = await loadQuoteForShare(link.quoteId);
  if (!quote) return null;
  if (!isLinkCurrentlyValid(link, quote, now)) return null;

  const shouldCountView = !link.lastViewedAt || now.getTime() - link.lastViewedAt.getTime() >= VIEW_COUNT_THROTTLE_MS;
  if (shouldCountView) {
    // updateMany statt update: die Bedingung ist Teil des WHERE (kein Race mit einem
    // zwischenzeitlichen zweiten Aufruf), keine Rueckgabe noetig — der Zaehlerstand ist
    // fuer die Antwort dieser Anfrage nur naeherungsweise relevant.
    await dbInternal.quoteShareLink.updateMany({
      where: {
        id: link.id,
        OR: [{ lastViewedAt: null }, { lastViewedAt: { lt: new Date(now.getTime() - VIEW_COUNT_THROTTLE_MS) } }],
      },
      data: { viewCount: { increment: 1 }, lastViewedAt: now },
    });
  }

  return { link: shouldCountView ? { ...link, viewCount: link.viewCount + 1, lastViewedAt: now } : link, quote };
}

/** Nur fuer decideOffer: laedt Link + Angebot ohne Seiteneffekt (kein viewCount-Zaehler — das ist keine Ansicht). */
export async function resolveShareLinkForDecision(token: string, now: Date = new Date()): Promise<ResolvedShareLink | null> {
  const tokenHash = hashToken(token);
  const link = await dbInternal.quoteShareLink.findFirst({ where: { tokenHash } });
  if (!link) return null;

  const quote = await loadQuoteForShare(link.quoteId);
  if (!quote) return null;
  if (!isLinkCurrentlyValid(link, quote, now)) return null;

  return { link, quote };
}
