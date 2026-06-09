/**
 * Validiert eine XRechnung gegen das OFFIZIELLE EN-16931-UBL-Schematron —
 * in purem Node via SaxonJS (xslt3), ohne Java.
 *
 * Aufruf:
 *   npm run validate:erechnung                # erzeugt ein Sample und prüft es
 *   npm run validate:erechnung -- pfad/zur.xml
 *
 * Exit-Code 0 = bestanden, 1 = Schematron-Verletzung(en). Das offizielle
 * EN-16931-XSLT wird beim ersten Lauf nach validation/.cache geladen (gitignored).
 */
import { execSync } from "node:child_process";
import { mkdirSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = path.join(ROOT, "validation", ".cache");
const XSLT = path.join(CACHE, "EN16931-UBL-validation.xslt");
// Gepinnt auf eine EN-16931-Validierungs-Release (reproduzierbar).
const XSLT_URL =
  "https://raw.githubusercontent.com/ConnectingEurope/eInvoicing-EN16931/validation-1.3.13/ubl/xslt/EN16931-UBL-validation.xslt";

async function ensureXslt(): Promise<void> {
  if (existsSync(XSLT)) return;
  mkdirSync(CACHE, { recursive: true });
  const res = await fetch(XSLT_URL);
  if (!res.ok) throw new Error(`XSLT-Download fehlgeschlagen (HTTP ${res.status}). Netzwerk/URL prüfen.`);
  writeFileSync(XSLT, await res.text(), "utf8");
  console.error(`[validate] EN-16931-XSLT geladen -> ${path.relative(ROOT, XSLT)}`);
}

async function main(): Promise<void> {
  let target = process.argv[2];
  if (!target) {
    mkdirSync(CACHE, { recursive: true });
    target = path.join(CACHE, "sample-xrechnung.xml");
    execSync(`npx tsx scripts/generate-sample-xrechnung.ts "${target}"`, { cwd: ROOT, stdio: "inherit" });
  }
  await ensureXslt();

  const svrl = path.join(CACHE, "report.svrl.xml");
  execSync(`npx xslt3 -xsl:"${XSLT}" -s:"${target}" -o:"${svrl}"`, { cwd: ROOT, stdio: "pipe" });

  const report = readFileSync(svrl, "utf8");
  const blocks = report.split("<svrl:failed-assert").slice(1);
  const errors: { flag: string; text: string }[] = [];
  let warnings = 0;
  for (const b of blocks) {
    const flag = b.match(/flag="([^"]*)"/)?.[1] ?? "fatal";
    const text = (b.match(/<svrl:text>([\s\S]*?)<\/svrl:text>/)?.[1] ?? "").replace(/\s+/g, " ").trim();
    if (flag === "warning") warnings++;
    else errors.push({ flag, text });
  }

  if (errors.length === 0) {
    console.log(`✅ EN-16931-Schematron BESTANDEN — ${path.basename(target)} (${warnings} Warnung(en))`);
    process.exit(0);
  }
  console.error(`❌ EN-16931-Schematron: ${errors.length} Verletzung(en) in ${path.basename(target)}:`);
  for (const e of errors) console.error(`   - [${e.flag}] ${e.text.slice(0, 160)}`);
  process.exit(1);
}

main().catch((e) => {
  console.error((e as Error).message ?? e);
  process.exit(1);
});
