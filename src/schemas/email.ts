import { z } from "zod";

/** Dokumenttypen, die per E-Mail versendet werden koennen. */
export const EMAIL_DOC_TYPES = ["ANGEBOT", "AUFTRAGSBESTAETIGUNG", "PROFORMA", "INVOICE", "CREDIT_NOTE", "DUNNING", "DELIVERY_NOTE"] as const;
export const EmailDocType = z.enum(EMAIL_DOC_TYPES);
export type EmailDocType = z.infer<typeof EmailDocType>;

const email = z.string().trim().pipe(z.email("Ungueltige E-Mail-Adresse"));

/** Kommagetrennte Adressliste -> Array; leer erlaubt; max. 20. */
export const addressListSchema = z
  .string()
  .default("")
  .transform((s) => s.split(/[,;]/).map((x) => x.trim()).filter(Boolean))
  .pipe(z.array(email).max(20, "Maximal 20 Empfaenger"));

export const mailSettingsInputSchema = z.object({
  host: z.string().trim().min(1, "Host fehlt"),
  port: z.coerce.number().int().min(1).max(65535),
  security: z.enum(["STARTTLS", "TLS", "NONE"]),
  username: z.string().trim().optional(),
  /** leer = unveraendert lassen */
  password: z.string().optional(),
  fromName: z.string().trim().min(1, "Absendername fehlt"),
  fromEmail: email,
  replyTo: email.optional().or(z.literal("")),
  defaultCc: z.string().default(""),
  defaultBcc: z.string().default(""),
  copyToSelf: z.boolean().default(false),
});
export type MailSettingsInput = z.infer<typeof mailSettingsInputSchema>;

export const emailTemplateInputSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1).max(120),
  docType: EmailDocType,
  subject: z.string().trim().min(1).max(300),
  body: z.string().min(1).max(20000),
  signature: z.string().max(5000).optional(),
  isDefault: z.boolean().default(false),
});
export type EmailTemplateInput = z.infer<typeof emailTemplateInputSchema>;

export const sendEmailInputSchema = z.object({
  docType: EmailDocType,
  docId: z.string().min(1),
  to: addressListSchema.pipe(z.array(email).min(1, "Mindestens ein Empfaenger")),
  cc: addressListSchema,
  bcc: addressListSchema,
  subject: z.string().trim().min(1).max(300),
  body: z.string().min(1).max(50000),
  signature: z.string().max(5000).default(""),
  copyToSelf: z.boolean().default(false),
  /** Dateinamen der Standardanhaenge, die mitgehen sollen */
  standardAttachments: z.array(z.string()).default([]),
  templateId: z.string().optional(),
  resendOfId: z.string().optional(),
  /** Warnungen aus der Vorbelegung (z. B. unbekannte Platzhalter) — werden mitprotokolliert (G3). */
  warnings: z.array(z.string().max(300)).max(50).default([]),
  /** IDs bestehender Beleganhaenge (DocumentAttachment), die zusaetzlich mitgesendet werden
   *  sollen (Phase 4b) — send.ts laedt sie org- und beleggeprueft ueber loadAttachmentForSend. */
  attachmentIds: z.array(z.string()).default([]),
});
export type SendEmailInput = z.infer<typeof sendEmailInputSchema>;
/** Rohe Eingabeform vor dem Parsen (to/cc/bcc als kommagetrennter String statt Array) —
 *  die Domain (send.ts) parst selbst (G5, Lastenheft 55: kein Bypass ueber MCP/Route). */
export type SendEmailRawInput = z.input<typeof sendEmailInputSchema>;
