/**
 * Doku-Drift-Test (Task 3, Phase 9): jede per `registerTool("…")` registrierte MCP-Tool-ID muss
 * in docs/MCP.md als Backtick-ID vorkommen, und umgekehrt darf docs/MCP.md keine Backtick-ID
 * nennen, die nicht registriert ist — mit Ausnahme des Abschnitts "## Entfernt" (dort duerfen
 * alte, entfernte Toolnamen als Backtick-ID stehen, z. B. `save_document_settings`).
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const MCP_DIR = path.join(process.cwd(), "src/mcp");
const MCP_DOCS_PATH = path.join(process.cwd(), "docs/MCP.md");
// Fix-Welle Punkt 5: Ziffern zulassen (Tool-IDs koennten z. B. "..._v2" heissen) — bisher
// [a-z_]+, jetzt [a-z0-9_]+ wie vom Koordinator vorgegeben.
const TOOL_ID_RE = /registerTool\(\s*"([a-z0-9_]+)"/g;

/** Fix-Welle Punkt 5: rekursiv ueber ALLE .ts-Dateien unter src/mcp/** (nicht nur
 *  src/mcp/tools/) — schliesst insbesondere src/mcp/server.ts (Composition Root) mit ein,
 *  falls dort je wieder ein registerTool(...) direkt landet. */
function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectTsFiles(full));
    else if (entry.isFile() && entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

function collectRegisteredToolIds(): Set<string> {
  const ids = new Set<string>();
  for (const file of collectTsFiles(MCP_DIR)) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(TOOL_ID_RE)) {
      ids.add(match[1]);
    }
  }
  return ids;
}

/** Schneidet den Abschnitt "## Entfernt" (falls vorhanden) aus dem Markdown heraus, bis zur
 * naechsten "## "-Überschrift oder Dateiende — Backtick-IDs darin gelten nicht als Drift. */
function stripRemovedSection(markdown: string): string {
  const lines = markdown.split("\n");
  const out: string[] = [];
  let inRemoved = false;
  for (const line of lines) {
    if (/^##\s+Entfernt\b/.test(line)) {
      inRemoved = true;
      continue;
    }
    if (inRemoved && /^##\s+/.test(line)) {
      inRemoved = false;
    }
    if (!inRemoved) out.push(line);
  }
  return out.join("\n");
}

function collectDocBacktickIds(markdown: string): Set<string> {
  const ids = new Set<string>();
  const re = /`([a-z0-9_]+)`/g;
  for (const match of markdown.matchAll(re)) {
    ids.add(match[1]);
  }
  return ids;
}

describe("docs/MCP.md — Doku-Drift", () => {
  const registeredIds = collectRegisteredToolIds();
  const rawDocs = readFileSync(MCP_DOCS_PATH, "utf8");
  const docsWithoutRemoved = stripRemovedSection(rawDocs);
  const docIdsExcludingRemoved = collectDocBacktickIds(docsWithoutRemoved);

  it("registriert mindestens ein Tool (Regex/Verzeichnis funktionieren)", () => {
    expect(registeredIds.size).toBeGreaterThan(0);
  });

  it("jede registrierte Tool-ID kommt in docs/MCP.md als Backtick-ID vor", () => {
    const missing = [...registeredIds].filter((id) => !docIdsExcludingRemoved.has(id)).sort();
    expect(missing, `In docs/MCP.md fehlende Tool-IDs: ${missing.join(", ")}`).toEqual([]);
  });

  it("docs/MCP.md nennt keine Backtick-ID, die aussieht wie ein Tool-Name, aber nicht registriert ist (ausserhalb '## Entfernt')", () => {
    const toolLikePattern = /^[a-z0-9]+(_[a-z0-9]+)+$/;
    const stray = [...docIdsExcludingRemoved]
      .filter((id) => toolLikePattern.test(id) && !registeredIds.has(id))
      .sort();
    expect(stray, `In docs/MCP.md genannte, nicht registrierte Tool-IDs: ${stray.join(", ")}`).toEqual([]);
  });
});
