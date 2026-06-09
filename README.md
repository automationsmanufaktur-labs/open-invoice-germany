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

Claude calls the right tools in order (create customer/service → invoice → finalise → PDF + XRechnung). Finalising **enforces** the § 14 UStG mandatory fields — non-compliant invoices are rejected, and everything stays local. Setup + examples: **[docs/MCP.md](docs/MCP.md)**.

```bash
npm run mcp   # start the MCP server (stdio) / wire it into Claude Code via .mcp.json
```

## Features

- **Voice control via MCP** (Claude Code/Desktop) — see above.
- **GoBD core**: finalisation (draft → immutable), gapless number ranges, append-only audit **hash-chain**, cancellation instead of deletion.
- **§ 14 UStG**: mandatory-field check blocks finalisation when data is missing.
- **Tax schemes**: standard rating (19/7/0), small business (§ 19), reverse charge (§ 13b), intra-EU supply, margin scheme (§ 25a), small amount (§ 33).
- **E-invoice**: **XRechnung** (UBL, EN 16931) export incl. EN-16931 core-rule validation. ZUGFeRD/Factur-X via the Mustang sidecar (Docker).
- **PDF export** ("other invoice") with all mandatory fields.
- **Self-hosted**: SQLite solo without a server **or** PostgreSQL via Docker.
- **Sign-in**: built-in admin account (scrypt hash + signed session cookie) — app and API protected.

### Status

MVP. What works: master data/customers/products, quote & invoice model, draft → finalise → cancel, PDF + XRechnung export, GoBD number range + audit. On the roadmap: dunning UI, recurring invoices, ZUGFeRD hybrid, DATEV export, B2G/Leitweg-ID, OSS/ZM, multi-user. See [docs/ARCHITEKTUR.md](docs/ARCHITEKTUR.md) (MVP / stage 2 / stage 3) and the honest list of **[known limitations](docs/LIMITATIONEN.md)**.

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

`docker-compose.yml` starts the app + PostgreSQL + the **Mustang** sidecar (XRechnung/ZUGFeRD generation & validation). The Postgres schema lives in `prisma/schema.postgres.prisma` (model-identical, only a different datasource).

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

## License

**[AGPL-3.0](LICENSE).** You may use, modify and self-host the software. Anyone who runs it as a network service must make the (modified) source available to its users — keeping the project free for everyone. Rationale for the licence choice: [docs/ARCHITEKTUR.md](docs/ARCHITEKTUR.md#3-lizenz-empfehlung).
