/**
 * Erzeugung von API-Schluesseln (Phase 10, Task 1, task-1-facts.md).
 *
 * Token-Format: `oig_` + base64url(32 zufaellige Bytes) via node:crypto. Nur der
 * SHA-256-Hash (hex) wird gespeichert; `prefix` sind die ersten 8 Zeichen NACH `oig_`
 * (fuer die Anzeige in der Liste, § Einstellungen -> API). Das Klartext-Token wird
 * ausschliesslich im Rueckgabewert von `createApiKey` einmalig sichtbar — die DB
 * speichert es nie.
 */
import { createHash, randomBytes } from "node:crypto";
import { dbInternal } from "@/lib/db";
import { logActivity } from "@/domain/activity/log";
import { createApiKeyInputSchema, type ApiKeyScope, type CreateApiKeyInput } from "@/schemas";

const TOKEN_PREFIX = "oig_";

export interface GeneratedToken {
  token: string;
  prefix: string;
  hash: string;
}

/** Erzeugt ein neues Klartext-Token + Anzeige-Praefix + Speicher-Hash. Exportiert fuer Tests. */
export function generateApiToken(): GeneratedToken {
  const bytes = randomBytes(32);
  const token = TOKEN_PREFIX + bytes.toString("base64url");
  const prefix = token.slice(TOKEN_PREFIX.length, TOKEN_PREFIX.length + 8);
  const hash = hashApiToken(token);
  return { token, prefix, hash };
}

/** SHA-256(hex) eines Klartext-Tokens — dieselbe Funktion nutzt verify.ts beim Pruefen. */
export function hashApiToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Wandelt einen Namen in einen Audit-Actor-Slug (`api:<slug>`) um — Lastenheft-Ruling
 * (task-1-facts.md): "Audit-Actor: api:<keyName> (keyName aus ApiKey.name, slugified)".
 * Nicht-ASCII wird transliteriert (NFKD + Diakritika entfernen), Rest auf [a-z0-9-]
 * reduziert. Leerer Slug faellt auf "key" zurueck, damit der Actor nie leer ist.
 */
export function slugifyKeyName(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "key";
}

export interface CreatedApiKey {
  id: string;
  name: string;
  prefix: string;
  scopes: ApiKeyScope[];
  /** Klartext-Token — nur hier, nie wieder abrufbar. */
  token: string;
  expiresAt: Date | null;
  createdAt: Date;
}

export async function createApiKey(orgId: string, input: CreateApiKeyInput, createdBy?: string | null): Promise<CreatedApiKey> {
  const parsed = createApiKeyInputSchema.parse(input);
  const { token, prefix, hash } = generateApiToken();
  const row = await dbInternal.apiKey.create({
    data: {
      orgId,
      name: parsed.name,
      keyHash: hash,
      prefix,
      scopesJson: parsed.scopes.join(","),
      expiresAt: parsed.expiresAt ? new Date(parsed.expiresAt) : null,
      createdBy: createdBy ?? null,
    },
  });
  // Fix-Welle (Should-fix 6): Anlage eines Credentials, das lesend UND schreibend auf
  // alle GoBD-relevanten Daten zugreifen kann, muss protokolliert werden — NIE
  // Token/Hash im Protokoll (analog webhook/endpoints.ts, das schon appendChangeLog
  // nutzt; hier ActivityLog statt ChangeLog, Ruling: "ActivityLog, nicht ChangeLog").
  await logActivity(dbInternal, {
    orgId,
    entityType: "API_KEY",
    entityId: row.id,
    type: "CREATED",
    actor: createdBy ?? "system",
    data: { name: row.name, prefix: row.prefix, scopes: parsed.scopes },
  });

  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    scopes: parsed.scopes,
    token,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
  };
}
