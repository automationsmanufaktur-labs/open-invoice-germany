import { describe, it, expect } from "vitest";
import { addressListSchema, sendEmailInputSchema, mailSettingsInputSchema } from "@/schemas/email";

describe("addressListSchema", () => {
  it("zerlegt Komma-/Semikolon-getrennte Adressen", () => {
    const result = addressListSchema.parse("a@x.de, b@y.de;c@z.de");
    expect(result).toEqual(["a@x.de", "b@y.de", "c@z.de"]);
  });

  it("lehnt ungueltige Adressen ab", () => {
    const result = addressListSchema.safeParse("foo");
    expect(result.success).toBe(false);
  });
});

describe("sendEmailInputSchema", () => {
  it("verlangt mindestens einen Empfaenger", () => {
    const result = sendEmailInputSchema.safeParse({
      docType: "INVOICE",
      docId: "inv1",
      to: "",
      cc: "",
      bcc: "",
      subject: "Betreff",
      body: "Text",
    });
    expect(result.success).toBe(false);
  });

  it("akzeptiert gueltige Eingaben", () => {
    const result = sendEmailInputSchema.safeParse({
      docType: "INVOICE",
      docId: "inv1",
      to: "a@x.de",
      cc: "",
      bcc: "",
      subject: "Betreff",
      body: "Text",
    });
    expect(result.success).toBe(true);
  });
});

describe("mailSettingsInputSchema", () => {
  it("coerct port als String in eine Zahl", () => {
    const result = mailSettingsInputSchema.parse({
      host: "smtp.example.de",
      port: "587",
      security: "STARTTLS",
      fromName: "OpenInvoice",
      fromEmail: "noreply@example.de",
    });
    expect(result.port).toBe(587);
  });
});
