import { redirect } from "next/navigation";

// Phase 11b, Task 7: Druckoptionen sind ein Reiter innerhalb der Briefpapier-Seite
// geworden ("Briefpapier" | "Layouts" | "Druckoptionen") — alte Links leiten weiter.
export default function DruckoptionenRedirect(): never {
  redirect("/einstellungen/briefpapier?tab=druckoptionen");
}
