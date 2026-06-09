/**
 * Validiert eine E-Rechnung gegen die OFFIZIELLEN Schematron-Regeln — in purem
 * Node via SaxonJS (xslt3), ohne Java. Erkennt automatisch UBL (XRechnung) oder
 * CII (ZUGFeRD/Factur-X) und wählt die passenden Schematrons:
 *   - UBL: EN-16931-UBL (ConnectingEurope) + XRechnung-CIUS (KoSIT-Konfig)
 *   - CII: EN-16931-CII (KoSIT-Konfig)
 *
 * Aufruf:
 *   npm run validate:erechnung                # Sample (XRechnung-UBL) erzeugen + prüfen
 *   npm run validate:erechnung -- pfad/zur.xml
 *
 * Exit 0 = bestanden, 1 = Verletzung(en). Schematrons landen in validation/.cache
 * (gitignored). Für KoSIT-Schematrons (XRechnung-CIUS, CII) wird `unzip` benötigt.
 */
import { execSync } from "node:child_process";
import { mkdirSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = path.join(ROOT, "validation", ".cache");

const EN16931_UBL_XSLT = path.join(CACHE, "EN16931-UBL-validation.xslt");
const EN16931_UBL_URL =
  "https://raw.githubusercontent.com/ConnectingEurope/eInvoicing-EN16931/validation-1.3.13/ubl/xslt/EN16931-UBL-validation.xslt";

const KOSIT_DIR = path.join(CACHE, "kosit");
const KOSIT_ZIP = path.join(CACHE, "kosit-config.zip");
const KOSIT_URL =
  "https://github.com/itplr-kosit/validator-configuration-xrechnung/releases/download/release-2024-06-20/validator-configuration-xrechnung_3.0.2_2024-06-20.zip";
const XRECHNUNG_UBL_XSLT = path.join(KOSIT_DIR, "resources", "xrechnung", "3.0.2", "xsl", "XRechnung-UBL-validation.xsl");
const EN16931_CII_XSLT = path.join(KOSIT_DIR, "resources", "cii", "16b", "xsl", "EN16931-CII-validation.xsl");

async function download(url: string, dest: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download fehlgeschlagen (HTTP ${res.status}): ${url}`);
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

async function ensureKosit(): Promise<boolean> {
  if (existsSync(EN16931_CII_XSLT)) return true;
  try {
    if (!existsSync(KOSIT_ZIP)) await download(KOSIT_URL, KOSIT_ZIP);
    mkdirSync(KOSIT_DIR, { recursive: true });
    execSync(`unzip -oq "${KOSIT_ZIP}" -d "${KOSIT_DIR}"`, { stdio: "pipe" });
    return existsSync(EN16931_CII_XSLT);
  } catch {
    return false;
  }
}

function runSchematron(xsltPath: string, xmlPath: string, label: string): string[] {
  const svrl = path.join(CACHE, "report.svrl.xml");
  execSync(`npx xslt3 -xsl:"${xsltPath}" -s:"${xmlPath}" -o:"${svrl}"`, { cwd: ROOT, stdio: "pipe" });
  const report = readFileSync(svrl, "utf8");
  const errors: string[] = [];
  for (const block of report.split("<svrl:failed-assert").slice(1)) {
    const flag = block.match(/flag="([^"]*)"/)?.[1] ?? "fatal";
    if (flag === "warning") continue;
    const text = (block.match(/<svrl:text>([\s\S]*?)<\/svrl:text>/)?.[1] ?? "").replace(/\s+/g, " ").trim();
    errors.push(`[${label}/${flag}] ${text.slice(0, 160)}`);
  }
  return errors;
}

async function main(): Promise<void> {
  mkdirSync(CACHE, { recursive: true });

  let target = process.argv[2];
  if (!target) {
    target = path.join(CACHE, "sample-xrechnung.xml");
    execSync(`npx tsx scripts/generate-sample-xrechnung.ts "${target}"`, { cwd: ROOT, stdio: "inherit" });
  }

  const xml = readFileSync(target, "utf8");
  const isCII = xml.includes("CrossIndustryInvoice");
  const errors: string[] = [];
  const layers: string[] = [];

  if (isCII) {
    if (await ensureKosit()) {
      errors.push(...runSchematron(EN16931_CII_XSLT, target, "EN16931-CII"));
      layers.push("EN-16931-CII");
    } else {
      console.error("[validate] EN-16931-CII übersprungen — 'unzip' für die KoSIT-Konfiguration nötig.");
    }
  } else {
    if (!existsSync(EN16931_UBL_XSLT)) await download(EN16931_UBL_URL, EN16931_UBL_XSLT);
    errors.push(...runSchematron(EN16931_UBL_XSLT, target, "EN16931-UBL"));
    layers.push("EN-16931-UBL");
    if (await ensureKosit()) {
      errors.push(...runSchematron(XRECHNUNG_UBL_XSLT, target, "XRechnung"));
      layers.push("XRechnung-CIUS");
    } else {
      console.error("[validate] XRechnung-CIUS übersprungen — 'unzip' nötig.");
    }
  }

  if (errors.length === 0) {
    console.log(`✅ Schematron BESTANDEN (${layers.join(" + ") || "—"}) — ${path.basename(target)}`);
    process.exit(0);
  }
  console.error(`❌ Schematron: ${errors.length} Verletzung(en) in ${path.basename(target)}:`);
  for (const e of errors) console.error(`   - ${e}`);
  process.exit(1);
}

main().catch((e) => {
  console.error((e as Error).message ?? e);
  process.exit(1);
});
