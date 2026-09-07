import { redirect } from "next/navigation";

// Phase 7 (§33): "Dokumente" ist im Tab "Belege" aufgegangen — alte Links leiten weiter.
export default function DokumenteRedirect(): never {
  redirect("/einstellungen/belege");
}
