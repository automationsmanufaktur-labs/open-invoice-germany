/**
 * Reine Markenvorgaben ohne jede Abhaengigkeit (Phase 12c, Task 7 — Carry-over aus den
 * Task-Reviews). `src/domain/settings/brand.ts` zieht transitiv den Prisma-Client
 * ("@/lib/db") nach sich und darf daher nicht als Wert-Import in "use client"-Dateien
 * landen (Turbopack bricht sonst mit "chunking context does not support external
 * modules" ab). Diese Datei hat KEINE Imports und ist damit fuer Server- UND
 * Client-Komponenten gefahrlos importierbar — die EINZIGE Stelle mit den Literalen;
 * `brand.ts`, `AuthForm.tsx` und `MarkeForm.tsx` importieren von hier statt eigene
 * Kopien zu pflegen.
 */
export const DEFAULT_APP_NAME = "OpenInvoice Germany";
export const DEFAULT_APP_SHORT_NAME = "OI";
