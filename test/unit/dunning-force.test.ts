/**
 * Phase 8b Fix-Runde 1 (Ruling a) — reine Entscheidungsfunktion fuer den force/confirm-
 * Ablauf beim Anlegen einer Mahnung aus RowActionsMenu (DUNNING/REMINDER).
 */
import { describe, it, expect } from "vitest";
import { shouldForceDunningRetry } from "@/lib/dunning-force";

describe("shouldForceDunningRetry", () => {
  it("true bei 409, noch nicht erzwungen, Nutzer bestaetigt", () => {
    expect(shouldForceDunningRetry({ status: 409, alreadyForced: false, confirmed: true })).toBe(true);
  });

  it("false, wenn der Nutzer nicht bestaetigt", () => {
    expect(shouldForceDunningRetry({ status: 409, alreadyForced: false, confirmed: false })).toBe(false);
  });

  it("false, wenn bereits erzwungen (kein zweiter Retry-Loop)", () => {
    expect(shouldForceDunningRetry({ status: 409, alreadyForced: true, confirmed: true })).toBe(false);
  });

  it("false bei einem anderen Statuscode als 409", () => {
    expect(shouldForceDunningRetry({ status: 422, alreadyForced: false, confirmed: true })).toBe(false);
  });

  it("false bei Erfolg (200)", () => {
    expect(shouldForceDunningRetry({ status: 200, alreadyForced: false, confirmed: true })).toBe(false);
  });
});
