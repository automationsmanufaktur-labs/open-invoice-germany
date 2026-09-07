import Link from "next/link";
import { buildDocumentChain, type ChainNode } from "@/domain/document/chain";
import { StatusBadge } from "@/components/StatusBadge";

function NodeRow({ node, currentId, depth }: { node: ChainNode; currentId: string; depth: number }) {
  const isCurrent = node.id === currentId;
  return (
    <li>
      <div
        className={`flex flex-wrap items-center gap-2 rounded-md px-2 py-1.5 text-sm ${
          isCurrent ? "bg-indigo-50 font-semibold text-indigo-900" : "text-slate-700"
        }`}
        style={{ marginLeft: depth * 16 }}
      >
        <span className="text-slate-400">{node.label}</span>
        {node.href && !isCurrent ? (
          <Link href={node.href} className="text-indigo-600 hover:underline">
            {node.number ?? node.id.slice(0, 8)}
          </Link>
        ) : (
          <span>{node.number ?? node.id.slice(0, 8)}</span>
        )}
        <StatusBadge status={node.status} />
        {node.relation && <span className="text-xs text-slate-400">({node.relation})</span>}
        {isCurrent && <span className="text-xs text-indigo-600">← aktuell</span>}
      </div>
      {node.children.length > 0 && (
        <ul>
          {node.children.map((c) => (
            <NodeRow key={`${c.type}:${c.id}`} node={c} currentId={currentId} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

/** Zeigt die vollstaendige Dokumentkette (Angebot -> AB -> Lieferschein(e) -> Rechnung ->
 *  Zahlungen/Mahnungen) als eingerueckte Liste. Gibt bei Fehlern (z. B. Beleg nicht
 *  gefunden) still nichts aus, statt die Seite abzureissen. */
export async function DocumentChain({ orgId, type, id }: { orgId: string; type: "QUOTE" | "INVOICE" | "DELIVERY_NOTE"; id: string }) {
  let chain: Awaited<ReturnType<typeof buildDocumentChain>> | null = null;
  try {
    chain = await buildDocumentChain(orgId, type, id);
  } catch {
    return null;
  }
  if (!chain) return null;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="mb-2 text-sm font-semibold text-slate-900">Dokumentkette</h2>
      <ul>
        <NodeRow node={chain.root} currentId={chain.currentId} depth={0} />
      </ul>
    </div>
  );
}
