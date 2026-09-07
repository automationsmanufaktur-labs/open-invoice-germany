<div align="center">

<img src="https://raw.githubusercontent.com/automationsmanufaktur-labs/open-invoice-germany/main/assets/banner.svg" alt="OpenInvoice Germany — free self-hostable invoicing with XRechnung / EN 16931, GoBD and § 14 UStG" width="100%" />

# OpenInvoice Germany

**Free, self-hostable open-source invoicing software for Germany.**
E-invoice (XRechnung / ZUGFeRD) · GoBD · § 14 UStG · small business § 19 · GDPR

[![CI](https://github.com/automationsmanufaktur-labs/open-invoice-germany/actions/workflows/ci.yml/badge.svg)](https://github.com/automationsmanufaktur-labs/open-invoice-germany/actions/workflows/ci.yml)
&nbsp;·&nbsp; Licence: **AGPL-3.0** &nbsp;·&nbsp; **English** · [Deutsch](README.de.md)

</div>

> **Why?** From 2025 German B2B must be able to *receive* structured e-invoices; from 2027/2028 *sending* becomes mandatory. Many freelancers and SMEs pay a monthly fee just to stay compliant. This project makes it **free and open** — you host it yourself, your data stays with you.

> ⚠️ **Not tax or legal advice.** GoBD compliance additionally requires the user's own process documentation (Verfahrensdokumentation). All legal references with sources live in **[COMPLIANCE.md](COMPLIANCE.md)** (single source of truth). No warranty.

---

## 🗣️ Talk to it with Claude Code (MCP)

Connect your local instance to **Claude Code** or Claude Desktop and create legally sound invoices just by describing them:

> "Create an invoice to Müller GmbH for 3 hours of consulting at €95, delivered today, finalise it and export the XRechnung."

Claude calls the right tools in order (create customer/service → invoice → finalise → PDF + XRechnung). Finalising **enforces** the § 14 UStG mandatory fields — non-compliant invoices are rejected. The invoice is created and stored locally. Setup + examples: **[docs/MCP.md](docs/MCP.md)**.

```bash
npm run mcp   # start the MCP server (stdio) / wire it into Claude Code via .mcp.json
```

> 🔒 **Data protection (GDPR).** The app core runs **100% locally**, but the MCP feature is optional and **not automatically GDPR-compliant**: when you let a **cloud LLM** (e.g. Claude) create the invoice, the data you describe (customer name, items, amounts = personal data) is sent to that provider and processed on your behalf (Art. 28 GDPR). For business use with real personal data, either use a **local model** (the MCP server is model-agnostic) or a **commercial API with a DPA** — note that Claude **Code/Desktop** always use Anthropic's cloud and the consumer **Pro/Max subscription has no DPA**. List the provider as a sub-processor in your records and privacy policy. Details: **[docs/MCP.md](docs/MCP.md)**. Not legal advice.

## Features

- **Voice control via MCP** (Claude Code/Desktop) — see above.
- **GoBD core**: finalisation (draft → immutable), gapless number ranges, append-only audit **hash-chain**, cancellation instead of deletion.
- **§ 14 UStG**: mandatory-field check blocks finalisation when data is missing.
- **Tax schemes**: standard rating (19/7/0), small business (§ 19), reverse charge (§ 13b), intra-EU supply, margin scheme (§ 25a), small amount (§ 33).
- **E-invoice**: **XRechnung** (UBL, EN 16931) **and ZUGFeRD/Factur-X hybrid PDF** (embedded EN-16931 CII), both validated against the **official Schematron** rules (SaxonJS, no Java) — cross-checked by the KoSIT validator in CI.
- **Documents**: quotes, order confirmations, pro-forma — convertible into an invoice.
- **Payments & dunning**: record (partial) payments; staged reminders (payment reminder → 1st/2nd dunning) with **default interest** (§ 288 BGB, day-accurate) + €40 flat fee (B2B), each as a PDF.
- **Recurring invoices / subscriptions**: weekly–yearly templates, optional auto-finalisation, run via UI/MCP or cron (`npm run recurring:run`).
- **Credit notes**: full cancellation **or** partial credit, original stays finalised.
- **PDF export** ("other invoice") with all mandatory fields.
- **Self-hosted**: SQLite solo without a server **or** PostgreSQL via Docker.
- **Sign-in**: built-in admin account (scrypt hash + signed session cookie) — app and API protected.

### Status

MVP. What works: master data/customers/products, quotes & invoices, draft → finalise → cancel, partial credit notes, **payments + dunning (§ 288 BGB)**, **recurring invoices/subscriptions**, PDF + **XRechnung + ZUGFeRD** export, GoBD number range + audit. On the roadmap: DATEV/CSV export, B2G/Leitweg-ID EAS codes, OSS/ZM, multi-user, built-in scheduler. See [docs/ARCHITEKTUR.md](docs/ARCHITEKTUR.md) (MVP / stage 2 / stage 3) and the honest list of **[known limitations](docs/LIMITATIONEN.md)**.

## Documents workflow

Quote → order confirmation → delivery note → invoice, all linked:

1. Create a **quote** (draft, editable), send it — status moves `DRAFT → SENT`.
2. Mark it `ACCEPTED` (or convert it straight into an **order confirmation**).
3. **Convert** it into a **delivery note** (quantities from the quote/order, over-delivery blocked) and/or into an **invoice draft**.
4. Every conversion is recorded as a document relation; the **document chain** (visible on every quote/invoice/delivery-note page) shows the full lineage — quote → order confirmation → delivery note → invoice → payments/dunnings.
5. Billing status (none/partial/full) is derived from those relations, not stored.

Same tools via MCP: `convert_document`, `create_delivery_note`, `set_document_status`, `duplicate_document`. Details: [docs/ARCHITEKTUR.md](docs/ARCHITEKTUR.md), limitations: [docs/LIMITATIONEN.md](docs/LIMITATIONEN.md).

### Let customers accept quotes online

On a quote's detail page (**Documents → quote**), under "Acceptance link", generate a link — the URL is shown **once** (copy button), and can't be retrieved again afterwards. The customer opens it without logging in, sees the quote and a PDF download, and can accept or reject it (name required, email/comment optional). On decision: status `ACCEPTED`/`REJECTED`, an internal notification email, and — depending on the setting under **Settings → Documents** — an automatic order confirmation or invoice draft. The link can be revoked at any time. For the `{{offer.link}}` placeholder in the quote email template, set `APP_BASE_URL` (`.env`) — otherwise it stays empty.

## Tech stack

Next.js 16 (App Router) · TypeScript (strict) · Prisma 6 · SQLite/PostgreSQL · TailwindCSS · Zod · Vitest.
Money as integer cents, quantities as integer milli-units, tax per EN-16931 group — see [docs/ARCHITEKTUR.md](docs/ARCHITEKTUR.md).

## Quick start (solo / SQLite — no server needed)

```bash
git clone https://github.com/automationsmanufaktur-labs/open-invoice-germany.git
cd open-invoice-germany
npm install
cp .env.example .env            # DATABASE_URL="file:./dev.db" is the default
npm run db:migrate              # create the schema
npm run db:seed                 # optional demo data
npm run dev                     # http://localhost:3000
```

The SQLite file lives at `prisma/dev.db` and belongs to you alone. On first start you create your admin account under **`/setup`** (after `npm run db:seed` there is a demo login `admin@example.com` / `demo1234` — please change it). For **production**: set `AUTH_SECRET` in `.env` (`openssl rand -base64 32`) and run behind HTTPS.

**In the app:** `Settings` (create company) → `Customers` → `New invoice` → add line items → **Finalise** (assigns the number, makes it GoBD-immutable) → **PDF** and **XRechnung** export. Full step-by-step guide: **[docs/ANLEITUNG.md](docs/ANLEITUNG.md)** (German).

## With Docker (PostgreSQL + ZUGFeRD sidecar)

```bash
cp .env.example .env            # switch DATABASE_URL to the postgresql:// line
docker compose up --build
```

**Upgrading an existing instance.** If the database was created with an older
version using `prisma db push`, it has no migration history. The container will
refuse to start and print the one command needed. Take a backup first.

**Do not run `migrate resolve` blindly.** The `0_init` baseline reflects the
current schema, including `RecurringInvoice`, `RecurringInvoiceLine` and
`Invoice.recurringInvoiceId`. An older instance may predate these tables. If you
mark the baseline as applied without checking, Prisma believes the schema is
complete and later queries fail with `column ... does not exist`. Verify first:

```bash
docker compose run --rm app \
  npx prisma migrate diff --from-url "$DATABASE_URL" \
    --to-schema-datamodel prisma/schema.postgres.prisma --script
```

**Important:** `--to-schema-datamodel` compares against the current model
(head), not against the `0_init` baseline. The baseline reference is
`prisma/migrations-postgres/0_init/migration.sql` only. The diff can therefore
also show tables or columns that were only introduced by a **later** migration
under `prisma/migrations-postgres/` (e.g. the phase-0 snapshot columns) — those
must **not** be applied by hand; `migrate deploy` applies them automatically
after the `resolve` step. To tell which migration introduces a given column,
run `grep -l "<column name>" prisma/migrations-postgres/*/migration.sql`: if it
only appears in `0_init`, it belongs to the baseline; if it (also) appears in a
later migration, it came from there and must not be created by hand.

- **Empty output** (only the comment "This is an empty migration"): the database
  already matches the baseline. `migrate resolve --applied 0_init` below is safe.
- **Output contains only `CREATE TABLE` / `ALTER TABLE ... ADD COLUMN` /
  `CREATE INDEX` / `ALTER TABLE … ADD CONSTRAINT` (foreign keys)**: apply only
  the statements that belong to `0_init` (see the `grep` rule above); leave out
  statements for columns/tables that come from later migrations. Review the
  remaining SQL, apply it with `docker compose run --rm app npx prisma db
  execute --url "$DATABASE_URL" --stdin`, then continue with `migrate resolve`.
- **Output contains any `DROP`**: stop. Do not apply it and do not run
  `migrate resolve`. The database holds data the baseline does not account for —
  get a second opinion before proceeding.

Once the diff is clean (or has been applied):

```bash
docker compose run --rm app \
  npx prisma migrate resolve --config prisma.postgres.config.ts --applied 0_init
```

After that the container starts normally and future schema changes go through
`prisma migrate deploy`.

**If a migration entry in `_prisma_migrations` is marked failed**, `migrate
deploy` refuses to proceed and the container will not start. This is intentional
(fail-closed) rather than silently continuing on an uncertain schema. Check what
the migration partially applied, then resolve it with `prisma migrate resolve
--rolled-back <name>`.

`docker-compose.yml` starts the app + PostgreSQL. The **Mustang** sidecar (XRechnung/ZUGFeRD generation & validation) is an optional, commented-out block (`einvoice-service/` is not shipped) — see the section above. The Postgres schema lives in `prisma/schema.postgres.prisma` (model-identical, only a different datasource).

## Sending emails (E-Mail-Versand einrichten)

SMTP only — no built-in Resend/SES integration (see [docs/ARCHITEKTUR.md](docs/ARCHITEKTUR.md)). Steps:

1. Go to **Einstellungen → E-Mail-Versand** and enter your SMTP host, port, security mode, credentials, and sender address.
2. `AUTH_SECRET` (see `.env.example`) also serves as the encryption key for the stored SMTP password — set it before configuring mail, and re-enter the password if you ever rotate `AUTH_SECRET`.
3. Click **Testmail senden** to verify the configuration before using it on real documents.
4. Under **Einstellungen → Vorlagen**, adjust the built-in email templates (subject/body/signature) per document type, or add your own; placeholders like `{{document.number}}` are listed in the editor.
5. Sending is currently plain text only, with no delivery/bounce tracking (status stays `SENT`) — see [docs/LIMITATIONEN.md](docs/LIMITATIONEN.md) for the full list of email limitations.

## Tests

```bash
npm test          # Vitest: money, tax, number ranges, GoBD immutability, hash-chain, EN 16931
```

The integration tests prove, among other things, **gapless, immutable number ranges** and that finalised invoices cannot be edited.

## E-invoice validation

```bash
npm run validate:erechnung      # official Schematron rules, no Java
```

Validates the generated XRechnung against the **official Schematron rules** in pure Node via SaxonJS:
- **EN-16931 UBL Schematron** (ConnectingEurope) and
- **XRechnung CIUS / BR-DE** (official KoSIT config 3.0.2; requires `unzip`).

This is essentially the same Schematron check as the **[KoSIT validator](https://github.com/itplr-kosit/validator)** — and runs as a **hard gate in CI**. The KoSIT validator (Java) additionally runs there as an independent cross-check (also covering the upstream XSD check). Fast core rules are part of `npm test`.

## Contributing

Contributions welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). Please file legal corrections with a source (statute/BMF letter) against [COMPLIANCE.md](COMPLIANCE.md).

## Maintainer

Built and maintained by [AutomationsManufaktur](https://automationsmanufaktur.de), Bardowick (Germany).
Questions on German e-invoicing compliance: info@automationsmanufaktur.de

## License

**[AGPL-3.0](LICENSE).** You may use, modify and self-host the software. Anyone who runs it as a network service must make the (modified) source available to its users — keeping the project free for everyone. Rationale for the licence choice: [docs/ARCHITEKTUR.md](docs/ARCHITEKTUR.md#3-lizenz-empfehlung).
