"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { decideOffer, AlreadyDecidedError, InvalidShareLinkError } from "@/domain/quote-share/decide";
import { RateLimitError } from "@/lib/rate-limit";
import { clientIpFromHeaders } from "@/lib/http/client-ip";
import type { ActionResult } from "@/app/actions/result";

/**
 * G5: Zod-Fehler auf feste deutsche Feldtexte mappen — NIE den rohen Zod-Pfad oder die
 * Zod-Meldung an den Kunden durchreichen (Sicherheitsregel: Fehlertexte ohne Zod-Pfade).
 * Unbekannte Felder/Codes fallen auf eine generische Meldung zurueck.
 */
function germanFieldError(err: z.ZodError): string {
  for (const issue of err.issues) {
    const field = issue.path[0];
    if (field === "name") return "Bitte geben Sie Ihren Namen an.";
    if (field === "email") return "Bitte geben Sie eine gueltige E-Mail-Adresse an oder lassen Sie das Feld leer.";
    if (field === "comment") return "Der Kommentar ist zu lang (maximal 2000 Zeichen).";
    if (field === "decision") return "Bitte waehlen Sie Annehmen oder Ablehnen.";
  }
  return "Die Eingabe konnte nicht verarbeitet werden. Bitte pruefen Sie Ihre Angaben.";
}

/**
 * Einzige oeffentliche Schreibaktion der Angebotsseite (Phase 3b, Task 3). Ruft
 * ausschliesslich `decideOffer` auf — Zod-Validierung und Rate-Limiting laufen dort
 * (Domain, kein Bypass ueber die Action). IP kommt aus `cf-connecting-ip`/
 * `x-forwarded-for` (Ruling).
 */
export async function decideOfferAction(
  token: string,
  _prev: ActionResult,
  fd: FormData,
): Promise<ActionResult> {
  const raw = {
    decision: fd.get("decision"),
    name: fd.get("name"),
    email: fd.get("email"),
    comment: fd.get("comment") || undefined,
  };

  try {
    const h = await headers();
    const ip = clientIpFromHeaders(h) ?? undefined;
    await decideOffer(token, raw, { ip });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return { ok: false, error: germanFieldError(e) };
    }
    if (e instanceof InvalidShareLinkError) {
      return { ok: false, error: "Dieser Link ist ungueltig, abgelaufen oder wurde widerrufen." };
    }
    if (e instanceof AlreadyDecidedError) {
      return { ok: false, error: "Zu diesem Angebot liegt bereits eine Entscheidung vor." };
    }
    if (e instanceof RateLimitError) {
      return { ok: false, error: "Zu viele Versuche — bitte spaeter erneut versuchen." };
    }
    console.error("decideOfferAction:", e);
    return { ok: false, error: "Die Entscheidung konnte nicht gespeichert werden." };
  }

  revalidatePath(`/angebot/${token}`);
  return { ok: true };
}
