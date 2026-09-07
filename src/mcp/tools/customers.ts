// ── Kunden (Stammdaten, Adressen, Ansprechpartner, Vorgaben, Custom Fields) ──
// Task 1 (Phase 9): reiner Move aus server.ts + neue Tools update_customer/
// archive_customer (Domain: archiveCustomer aus src/domain/customer/archive.ts).
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { dbInternal } from "@/lib/db";
import { customerOverview } from "@/domain/customer/overview";
import { listAddresses, createAddress, updateAddress, deleteAddress, setDefaultAddress } from "@/domain/customer/addresses";
import { listContacts, createContact, updateContact, deleteContact, setDefaultContact } from "@/domain/customer/contacts";
import { saveCustomerDefaults, customerDefaultsFor } from "@/domain/customer/defaults";
import {
  listCustomFieldDefinitions,
  upsertCustomFieldDefinition,
  deleteCustomFieldDefinition,
  reorderCustomFields,
  setCustomerCustomFields,
  parseCustomerCustomFields,
} from "@/domain/customer/custom-fields";
import { archiveCustomer } from "@/domain/customer/archive";
import { createCustomer, updateCustomer, CustomerValidationError } from "@/domain/customer/save";
import { NotFoundError, InvalidOperationError } from "@/domain/errors";
import {
  customerSchema,
  customerAddressInputSchema,
  contactPersonInputSchema,
  customFieldDefinitionInputSchema,
  customFieldsReorderSchema,
  customerDefaultsInputSchema,
} from "@/schemas";
import { ToolError, type McpToolsContext, type Result } from "./context";

export function registerCustomerTools(server: McpServer, ctx: McpToolsContext): void {
  // ── list_customers ───────────────────────────────────────────────────────────
  server.registerTool(
    "list_customers",
    {
      title: "Kunden auflisten",
      description: "Listet die Kunden (optional gefiltert nach Namensteil).",
      inputSchema: { query: z.string().optional().describe("Namensteil zum Filtern") },
    },
    async ({ query }): Promise<Result> => {
      // Testbarkeit-/Korrektheits-Fix (Task 2): fehlte bisher orgId im where — listete
      // Kunden ueber ALLE Organisationen hinweg statt nur der aktiven (anders als jedes
      // andere Kunden-Tool in dieser Datei, die alle ueber ctx.requireOrg()+orgId scopen).
      // Fix-Welle Punkt 4: requireOrg jetzt innerhalb try/catch (analog list_documents in
      // documents.ts) statt ungefangen durchzuwerfen.
      let org: Awaited<ReturnType<typeof ctx.requireOrg>>;
      try {
        org = await ctx.requireOrg();
      } catch {
        return ctx.fail("Kein Unternehmen eingerichtet. Zuerst setup_company.");
      }
      const all = await dbInternal.customer.findMany({ where: { orgId: org.id, isArchived: false }, orderBy: { name: "asc" } });
      const filtered = query ? all.filter((c) => c.name.toLowerCase().includes(query.toLowerCase())) : all;
      return ctx.ok(
        JSON.stringify(
          filtered.map((c) => ({ id: c.id, name: c.name, city: c.city, type: c.type, vatId: c.vatId })),
          null,
          2,
        ),
      );
    },
  );

  // ── upsert_customer ──────────────────────────────────────────────────────────
  server.registerTool(
    "upsert_customer",
    {
      title: "Kunde anlegen/aktualisieren",
      description:
        "Legt einen Kunden an oder aktualisiert ihn (Match per exaktem Namen). Für rechtssichere Rechnungen sind Name + vollständige Anschrift nötig.",
      // Fix-Welle Punkt 8: Feldliste aus customerSchema komponiert statt handgepflegtem
      // inline-Zod (analog update_customer/Fix-Runde 1) — sonst driften upsert_customer und
      // customerSchema/saveCustomer auseinander (z. B. fehlten hier bisher addressLine2,
      // phone, peppolId, customerNumber). Lookup-Feld "name" bleibt ueber customerSchema
      // (min(1)) Pflicht. defaultPaymentMethodId entfaellt: der MCP-Aufrufer uebergibt einen
      // Namen/Code (defaultPaymentMethod), keine interne ID.
      inputSchema: {
        ...customerSchema.omit({ defaultPaymentMethodId: true }).shape,
        defaultPaymentMethod: z.string().optional().describe("Name oder Code der Standard-Zahlungsmethode"),
      },
    },
    async (args): Promise<Result> => {
      try {
        const org = await ctx.requireOrg();
        const { defaultPaymentMethod, ...rest } = args;
        const method = defaultPaymentMethod ? await ctx.resolvePaymentMethod(org.id, defaultPaymentMethod) : null;
        // Fix-Runde 1 (Koordinator-Ruling a, 2026-09-04): Anlage/Aenderung laeuft
        // ausschliesslich ueber src/domain/customer/save.ts (createCustomer/
        // updateCustomer) — kein eigenes Feld-Mapping/Prisma-Write mehr hier. Die
        // Namens-Zuordnung ("Match per exaktem Namen") bleibt Tool-spezifisch.
        // defaultPaymentMethodId nur als Schluessel setzen, wenn tatsaechlich ein
        // defaultPaymentMethod aufgeloest wurde — sonst wuerde updateCustomer (PATCH-
        // Semantik: Schluessel vorhanden -> Feld anfassen) eine bestehende Standard-
        // Zahlungsmethode faelschlich auf null zuruecksetzen, nur weil der Aufrufer das
        // Feld schlicht nicht mitgegeben hat.
        const payload = { ...rest, email: rest.email ?? "", ...(method ? { defaultPaymentMethodId: method.id } : {}) };
        const existing = (await dbInternal.customer.findMany({ where: { orgId: org.id, isArchived: false } })).find(
          (c) => c.name.toLowerCase() === (rest.name ?? "").toLowerCase(),
        );
        const customer = existing ? await updateCustomer(org.id, existing.id, payload) : await createCustomer(org.id, payload);
        return ctx.ok(`Kunde ${existing ? "aktualisiert" : "angelegt"}: ${customer.name} (${customer.id}).`);
      } catch (e) {
        if (e instanceof z.ZodError) return ctx.fail(`Validierung fehlgeschlagen: ${e.issues.map((i) => i.message).join("; ")}`);
        if (e instanceof CustomerValidationError) return ctx.fail(e.message);
        if (e instanceof ToolError) return ctx.fail(e.message);
        return ctx.failUnknown(e);
      }
    },
  );

  // ── update_customer ──────────────────────────────────────────────────────────
  // Fix-Runde 1 (Koordinator, Task 1): Feldliste jetzt aus customerSchema.partial()
  // komponiert statt handgepflegtem inline-Zod — sonst geht z. B. die E-Mail-Format-
  // Pruefung verloren und die Felder driften auseinander (§55, dieselbe Validierung wie
  // upsert_customer/saveCustomer). defaultPaymentMethodId bleibt ausgenommen: der MCP-
  // Aufrufer uebergibt einen Namen/Code (defaultPaymentMethod), keine interne ID.
  server.registerTool(
    "update_customer",
    {
      title: "Kunde bearbeiten (per ID/Name)",
      description:
        "Aktualisiert einen bestehenden Kunden gezielt per ID oder Name (anders als upsert_customer KEIN Anlegen). Nicht angegebene Felder bleiben unveraendert.",
      inputSchema: {
        customer: z.string().describe("Kunden-ID oder -Name"),
        ...customerSchema.partial().omit({ defaultPaymentMethodId: true }).shape,
        defaultPaymentMethod: z.string().optional().describe("Name oder Code der Standard-Zahlungsmethode"),
      },
    },
    async (args): Promise<Result> => {
      try {
        const org = await ctx.requireOrg();
        const existing = await ctx.resolveCustomer(org.id, args.customer);
        const { customer: _customerRef, defaultPaymentMethod, ...rest } = args;
        void _customerRef;
        // Fix-Runde 1 (Koordinator-Ruling a, 2026-09-04): PATCH-Anwendung laeuft jetzt
        // ueber src/domain/customer/save.ts#updateCustomer (nur die im Payload
        // vorhandenen Schluessel werden geschrieben) statt eines eigenen Patch-Baus hier.
        const payload: Record<string, unknown> = { ...rest };
        if (defaultPaymentMethod !== undefined) {
          const method = await ctx.resolvePaymentMethod(org.id, defaultPaymentMethod);
          payload.defaultPaymentMethodId = method.id;
        }
        const customer = await updateCustomer(org.id, existing.id, payload);
        return ctx.ok(`Kunde aktualisiert: ${customer.name} (${customer.id}).`);
      } catch (e) {
        if (e instanceof z.ZodError) return ctx.fail(`Validierung fehlgeschlagen: ${e.issues.map((i) => i.message).join("; ")}`);
        if (e instanceof CustomerValidationError) return ctx.fail(e.message);
        if (e instanceof ToolError) return ctx.fail(e.message);
        return ctx.failUnknown(e);
      }
    },
  );

  // ── archive_customer ─────────────────────────────────────────────────────────
  server.registerTool(
    "archive_customer",
    {
      title: "Kunde archivieren",
      description: "Archiviert einen Kunden (verschwindet aus list_customers/dem Kunden-Picker, bleibt aber in bestehenden Belegen als Snapshot erhalten).",
      inputSchema: { customer: z.string().describe("Kunden-ID oder -Name") },
    },
    async ({ customer }): Promise<Result> => {
      try {
        const org = await ctx.requireOrg();
        const existing = await ctx.resolveCustomer(org.id, customer);
        await archiveCustomer(org.id, existing.id);
        return ctx.ok(`Kunde archiviert: ${existing.name}.`);
      } catch (e) {
        if (e instanceof ToolError) return ctx.fail(e.message);
        return ctx.failUnknown(e);
      }
    },
  );

  // ── get_customer_overview ────────────────────────────────────────────────────
  server.registerTool(
    "get_customer_overview",
    {
      title: "Kunden-Uebersicht abrufen",
      description: "Liefert KPIs (offen/ueberfaellig/Gesamtumsatz) und die letzten Belege eines Kunden je Belegart (Rechnungen, Angebote, Lieferscheine, Abos).",
      inputSchema: { customer: z.string().describe("Kundenname oder -ID") },
    },
    async ({ customer }): Promise<Result> => {
      try {
        const org = await ctx.requireOrg();
        const c = await ctx.resolveCustomer(org.id, customer);
        const overview = await customerOverview(org.id, c.id);
        return ctx.ok(JSON.stringify(overview, null, 2));
      } catch (e) {
        if (e instanceof NotFoundError) return ctx.fail(e.message);
        if (e instanceof ToolError) return ctx.fail(e.message);
        return ctx.failUnknown(e);
      }
    },
  );

  // ── list_customer_addresses ────────────────────────────────────────────────────
  server.registerTool(
    "list_customer_addresses",
    {
      title: "Kunden-Zusatzadressen auflisten",
      description: "Listet alle Zusatzadressen (Rechnung/Lieferung/Sonstige) eines Kunden (§29, Phase 8a/§55).",
      inputSchema: { customer: z.string().describe("Kundenname oder -ID") },
    },
    async ({ customer }): Promise<Result> => {
      try {
        const org = await ctx.requireOrg();
        const c = await ctx.resolveCustomer(org.id, customer);
        const addresses = await listAddresses(org.id, c.id);
        return ctx.ok(JSON.stringify(addresses, null, 2));
      } catch (e) {
        if (e instanceof NotFoundError) return ctx.fail(e.message);
        if (e instanceof ToolError) return ctx.fail(e.message);
        return ctx.failUnknown(e);
      }
    },
  );

  // ── upsert_customer_address ────────────────────────────────────────────────────
  server.registerTool(
    "upsert_customer_address",
    {
      title: "Kunden-Zusatzadresse anlegen/aktualisieren",
      description:
        "Legt eine Zusatzadresse eines Kunden an (ohne id) oder ersetzt eine bestehende vollstaendig (mit id, §29). isDefault: true verdraengt den bisherigen Default desselben Typs.",
      inputSchema: {
        customer: z.string().describe("Kundenname oder -ID"),
        id: z.string().optional().describe("Adress-ID fuer ein Update; ohne id wird eine neue Adresse angelegt"),
        ...customerAddressInputSchema.shape,
      },
    },
    async ({ customer, id, ...args }): Promise<Result> => {
      try {
        const org = await ctx.requireOrg();
        const c = await ctx.resolveCustomer(org.id, customer);
        const address = id ? await updateAddress(org.id, c.id, id, args) : await createAddress(org.id, c.id, args);
        return ctx.ok(`Adresse gespeichert: ${JSON.stringify(address)}`);
      } catch (e) {
        if (e instanceof z.ZodError) return ctx.fail(`Validierung fehlgeschlagen: ${e.issues.map((i) => i.message).join("; ")}`);
        if (e instanceof NotFoundError) return ctx.fail(e.message);
        if (e instanceof InvalidOperationError) return ctx.fail(e.message);
        if (e instanceof ToolError) return ctx.fail(e.message);
        return ctx.failUnknown(e);
      }
    },
  );

  // ── delete_customer_address ────────────────────────────────────────────────────
  server.registerTool(
    "delete_customer_address",
    {
      title: "Kunden-Zusatzadresse loeschen",
      description: "Loescht eine Zusatzadresse eines Kunden (§29). Kein Snapshot-Effekt — Belege behalten ihre Adresse als Snapshot.",
      inputSchema: { customer: z.string().describe("Kundenname oder -ID"), id: z.string().describe("Adress-ID") },
    },
    async ({ customer, id }): Promise<Result> => {
      try {
        const org = await ctx.requireOrg();
        const c = await ctx.resolveCustomer(org.id, customer);
        await deleteAddress(org.id, c.id, id);
        return ctx.ok(`Adresse ${id} geloescht.`);
      } catch (e) {
        if (e instanceof NotFoundError) return ctx.fail(e.message);
        if (e instanceof ToolError) return ctx.fail(e.message);
        return ctx.failUnknown(e);
      }
    },
  );

  // ── set_default_address ────────────────────────────────────────────────────────
  // Nit (Fix-Welle): fehlte bisher als eigenes MCP-Tool — upsert_customer_address deckt
  // isDefault zwar mit ab, aber nur zusammen mit einem vollstaendigen Ersatz der Adresse
  // (§55, keine Bypass-Pfade — nutzt denselben Domain-Aufruf wie das UI).
  server.registerTool(
    "set_default_address",
    {
      title: "Kunden-Zusatzadresse als Default setzen",
      description: "Setzt eine Zusatzadresse als Default ihres Typs (§29); verdraengt den bisherigen Default desselben Typs.",
      inputSchema: { customer: z.string().describe("Kundenname oder -ID"), id: z.string().describe("Adress-ID") },
    },
    async ({ customer, id }): Promise<Result> => {
      try {
        const org = await ctx.requireOrg();
        const c = await ctx.resolveCustomer(org.id, customer);
        const address = await setDefaultAddress(org.id, c.id, id);
        return ctx.ok(`Default gesetzt: ${JSON.stringify(address)}`);
      } catch (e) {
        if (e instanceof NotFoundError) return ctx.fail(e.message);
        if (e instanceof ToolError) return ctx.fail(e.message);
        return ctx.failUnknown(e);
      }
    },
  );

  // ── list_contact_persons ───────────────────────────────────────────────────────
  server.registerTool(
    "list_contact_persons",
    {
      title: "Ansprechpartner auflisten",
      description: "Listet alle Ansprechpartner eines Kunden (§30, Phase 8a/§55).",
      inputSchema: { customer: z.string().describe("Kundenname oder -ID") },
    },
    async ({ customer }): Promise<Result> => {
      try {
        const org = await ctx.requireOrg();
        const c = await ctx.resolveCustomer(org.id, customer);
        const contacts = await listContacts(org.id, c.id);
        return ctx.ok(JSON.stringify(contacts, null, 2));
      } catch (e) {
        if (e instanceof NotFoundError) return ctx.fail(e.message);
        if (e instanceof ToolError) return ctx.fail(e.message);
        return ctx.failUnknown(e);
      }
    },
  );

  // ── upsert_contact_person ──────────────────────────────────────────────────────
  server.registerTool(
    "upsert_contact_person",
    {
      title: "Ansprechpartner anlegen/aktualisieren",
      description:
        "Legt einen Ansprechpartner eines Kunden an (ohne id) oder ersetzt einen bestehenden vollstaendig (mit id, §30). isDefault: true verdraengt den bisherigen kundenweiten Default.",
      inputSchema: {
        customer: z.string().describe("Kundenname oder -ID"),
        id: z.string().optional().describe("Ansprechpartner-ID fuer ein Update; ohne id wird ein neuer angelegt"),
        ...contactPersonInputSchema.shape,
      },
    },
    async ({ customer, id, ...args }): Promise<Result> => {
      try {
        const org = await ctx.requireOrg();
        const c = await ctx.resolveCustomer(org.id, customer);
        const contact = id ? await updateContact(org.id, c.id, id, args) : await createContact(org.id, c.id, args);
        return ctx.ok(`Ansprechpartner gespeichert: ${JSON.stringify(contact)}`);
      } catch (e) {
        if (e instanceof z.ZodError) return ctx.fail(`Validierung fehlgeschlagen: ${e.issues.map((i) => i.message).join("; ")}`);
        if (e instanceof NotFoundError) return ctx.fail(e.message);
        if (e instanceof InvalidOperationError) return ctx.fail(e.message);
        if (e instanceof ToolError) return ctx.fail(e.message);
        return ctx.failUnknown(e);
      }
    },
  );

  // ── delete_contact_person ──────────────────────────────────────────────────────
  server.registerTool(
    "delete_contact_person",
    {
      title: "Ansprechpartner loeschen",
      description: "Loescht einen Ansprechpartner eines Kunden (§30). Kein Snapshot-Effekt — Belege behalten ihn als Snapshot.",
      inputSchema: { customer: z.string().describe("Kundenname oder -ID"), id: z.string().describe("Ansprechpartner-ID") },
    },
    async ({ customer, id }): Promise<Result> => {
      try {
        const org = await ctx.requireOrg();
        const c = await ctx.resolveCustomer(org.id, customer);
        await deleteContact(org.id, c.id, id);
        return ctx.ok(`Ansprechpartner ${id} geloescht.`);
      } catch (e) {
        if (e instanceof NotFoundError) return ctx.fail(e.message);
        if (e instanceof ToolError) return ctx.fail(e.message);
        return ctx.failUnknown(e);
      }
    },
  );

  // ── set_default_contact ────────────────────────────────────────────────────────
  // Nit (Fix-Welle): siehe set_default_address oben.
  server.registerTool(
    "set_default_contact",
    {
      title: "Ansprechpartner als Default setzen",
      description: "Setzt einen Ansprechpartner als kundenweiten Default (§30); verdraengt den bisherigen Default.",
      inputSchema: { customer: z.string().describe("Kundenname oder -ID"), id: z.string().describe("Ansprechpartner-ID") },
    },
    async ({ customer, id }): Promise<Result> => {
      try {
        const org = await ctx.requireOrg();
        const c = await ctx.resolveCustomer(org.id, customer);
        const contact = await setDefaultContact(org.id, c.id, id);
        return ctx.ok(`Default gesetzt: ${JSON.stringify(contact)}`);
      } catch (e) {
        if (e instanceof NotFoundError) return ctx.fail(e.message);
        if (e instanceof ToolError) return ctx.fail(e.message);
        return ctx.failUnknown(e);
      }
    },
  );

  // ── update_customer_defaults ───────────────────────────────────────────────────
  server.registerTool(
    "update_customer_defaults",
    {
      title: "Kundenvorgaben aktualisieren",
      description:
        "Ersetzt die Kundenvorgaben eines Kunden vollstaendig (§28: Waehrung, Rabatt, E-Mail-Ziele, E-Rechnung-Vorliebe, Bestellreferenz, Konditionstexte, Sprache). Kein Merge — weggelassene optionale Felder werden zurueckgesetzt (NULL).",
      inputSchema: { customer: z.string().describe("Kundenname oder -ID"), ...customerDefaultsInputSchema.shape },
    },
    async ({ customer, ...args }): Promise<Result> => {
      try {
        const org = await ctx.requireOrg();
        const c = await ctx.resolveCustomer(org.id, customer);
        await saveCustomerDefaults(org.id, c.id, args);
        const view = await customerDefaultsFor(org.id, c.id);
        return ctx.ok(`Kundenvorgaben gespeichert: ${JSON.stringify(view)}`);
      } catch (e) {
        if (e instanceof z.ZodError) return ctx.fail(`Validierung fehlgeschlagen: ${e.issues.map((i) => i.message).join("; ")}`);
        if (e instanceof NotFoundError) return ctx.fail(e.message);
        if (e instanceof ToolError) return ctx.fail(e.message);
        return ctx.failUnknown(e);
      }
    },
  );

  // ── list_custom_fields ─────────────────────────────────────────────────────────
  server.registerTool(
    "list_custom_fields",
    {
      title: "Kundenfeld-Definitionen auflisten",
      description: "Listet alle benutzerdefinierten Kundenfeld-Definitionen der Organisation, aufsteigend nach Reihenfolge (§31).",
      inputSchema: {},
    },
    async (): Promise<Result> => {
      try {
        const org = await ctx.requireOrg();
        const definitions = await listCustomFieldDefinitions(org.id);
        return ctx.ok(JSON.stringify(definitions, null, 2));
      } catch (e) {
        if (e instanceof ToolError) return ctx.fail(e.message);
        return ctx.failUnknown(e);
      }
    },
  );

  // ── upsert_custom_field ────────────────────────────────────────────────────────
  server.registerTool(
    "upsert_custom_field",
    {
      title: "Kundenfeld-Definition anlegen/aktualisieren",
      description:
        "Legt eine Kundenfeld-Definition an (ohne id) oder ersetzt eine bestehende vollstaendig (mit id, §31). key ist je Organisation eindeutig; options nur bei type SELECT.",
      inputSchema: {
        id: z.string().optional().describe("Definitions-ID fuer ein Update; ohne id wird eine neue Definition angelegt"),
        ...customFieldDefinitionInputSchema.shape,
      },
    },
    async ({ id, ...args }): Promise<Result> => {
      try {
        const org = await ctx.requireOrg();
        const definition = await upsertCustomFieldDefinition(org.id, args, id);
        return ctx.ok(`Kundenfeld gespeichert: ${JSON.stringify(definition)}`);
      } catch (e) {
        if (e instanceof z.ZodError) return ctx.fail(`Validierung fehlgeschlagen: ${e.issues.map((i) => i.message).join("; ")}`);
        if (e instanceof NotFoundError) return ctx.fail(e.message);
        if (e instanceof InvalidOperationError) return ctx.fail(e.message);
        if (e instanceof ToolError) return ctx.fail(e.message);
        return ctx.failUnknown(e);
      }
    },
  );

  // ── delete_custom_field ────────────────────────────────────────────────────────
  // Nit (Fix-Welle): fehlte bisher als eigenes MCP-Tool (§55, keine Bypass-Pfade).
  server.registerTool(
    "delete_custom_field",
    {
      title: "Kundenfeld-Definition loeschen",
      description:
        "Loescht eine Kundenfeld-Definition der Organisation (§31). Bereits gespeicherte Werte bleiben im JSON der betroffenen Kunden stehen (kein Cleanup), werden aber beim Lesen still ignoriert.",
      inputSchema: { id: z.string().describe("Definitions-ID") },
    },
    async ({ id }): Promise<Result> => {
      try {
        const org = await ctx.requireOrg();
        await deleteCustomFieldDefinition(org.id, id);
        return ctx.ok(`Kundenfeld ${id} geloescht.`);
      } catch (e) {
        if (e instanceof NotFoundError) return ctx.fail(e.message);
        if (e instanceof ToolError) return ctx.fail(e.message);
        return ctx.failUnknown(e);
      }
    },
  );

  // ── reorder_custom_fields ──────────────────────────────────────────────────────
  // Nit (Fix-Welle): fehlte bisher als eigenes MCP-Tool (§55, keine Bypass-Pfade).
  server.registerTool(
    "reorder_custom_fields",
    {
      title: "Kundenfeld-Definitionen neu sortieren",
      description:
        "Setzt die Reihenfolge (sortOrder) aller Kundenfeld-Definitionen der Organisation neu (§31). ids muss genau die vorhandene Menge der Definitions-IDs enthalten.",
      inputSchema: { ...customFieldsReorderSchema.shape },
    },
    async (args): Promise<Result> => {
      try {
        const org = await ctx.requireOrg();
        await reorderCustomFields(org.id, args);
        const definitions = await listCustomFieldDefinitions(org.id);
        return ctx.ok(`Reihenfolge gespeichert: ${JSON.stringify(definitions)}`);
      } catch (e) {
        if (e instanceof z.ZodError) return ctx.fail(`Validierung fehlgeschlagen: ${e.issues.map((i) => i.message).join("; ")}`);
        if (e instanceof InvalidOperationError) return ctx.fail(e.message);
        if (e instanceof ToolError) return ctx.fail(e.message);
        return ctx.failUnknown(e);
      }
    },
  );

  // ── set_customer_custom_fields ─────────────────────────────────────────────────
  server.registerTool(
    "set_customer_custom_fields",
    {
      title: "Kundenfeld-Werte setzen",
      description:
        "Setzt die Kundenfeld-Werte eines Kunden (§31). Strikte Validierung gegen die aktiven Definitionen der Organisation: unbekannte Keys/Tippfehler werden abgelehnt. NUMBER-Werte als Dezimal-String (max. 4 Nachkommastellen, kein Float), DATE als YYYY-MM-DD.",
      inputSchema: {
        customer: z.string().describe("Kundenname oder -ID"),
        values: z.record(z.string(), z.unknown()).describe("Kundenfeld-Werte als { key: value }, gemaess den aktiven Definitionen"),
      },
    },
    async ({ customer, values }): Promise<Result> => {
      try {
        const org = await ctx.requireOrg();
        const c = await ctx.resolveCustomer(org.id, customer);
        const saved = await setCustomerCustomFields(org.id, c.id, values);
        const view = await parseCustomerCustomFields(org.id, saved.customFieldsJson);
        return ctx.ok(`Kundenfelder gespeichert: ${JSON.stringify(view)}`);
      } catch (e) {
        if (e instanceof z.ZodError) return ctx.fail(`Validierung fehlgeschlagen: ${e.issues.map((i) => i.message).join("; ")}`);
        if (e instanceof NotFoundError) return ctx.fail(e.message);
        if (e instanceof ToolError) return ctx.fail(e.message);
        return ctx.failUnknown(e);
      }
    },
  );
}
