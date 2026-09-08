// src/app/rechnungen/[id]/_parts/InvoiceMoreMenu.tsx
import Link from "next/link";
import { ActionMenu, ActionMenuItem, ActionMenuSeparator } from "@/components/detail/ActionMenu";
import { ConvertMenu } from "@/components/ConvertMenu";
import { DuplicateInvoiceButton } from "@/components/DuplicateInvoiceButton";
import { cancelAction } from "@/app/actions/invoices";

/**
 * "Mehr"-Menue der Rechnungsdetailseite (Phase 11d, Task 3) — buendelt XRechnung/ZUGFeRD,
 * Duplizieren, Teilgutschrift, Stornieren und die Lieferschein-Konvertierung, die frueher
 * im Aktionsleisten-/Korrekturbereich standen. Ruling (Brief): KEIN Druckoptionen-Eintrag
 * (kein Panel auf dieser Seite, Layout waehlt der Editor). Jeder Eintrag blendet sich
 * eigenstaendig nach derselben Bedingung ein wie zuvor — bei fehlender Berechtigung wird
 * der Eintrag nicht gezeigt (statt wie frueher deaktiviert dargestellt); die ausfuehrliche,
 * immer sichtbare Erklaerung mit deaktivierten Zustaenden bleibt in CorrectionSection.
 *
 * Fix 1 (Review): "Duplizieren" zusaetzlich an `!isDraft && !isCancelled` gebunden (altes
 * Verhalten — der Korrekturbereich, der DuplicateInvoiceButton frueher enthielt, war fuer
 * Entwuerfe/Stornos komplett ausgeblendet). Damit sind alle vier Bedingungen fuer einen
 * Entwurf false, `hasAnyItem` also false, und das "Mehr"-Menue rendert wie frueher gar
 * nicht erst (kein leerer/duplizierender Knopf neben "Bearbeiten"+"Festschreiben").
 */
export function InvoiceMoreMenu({
  invoiceId,
  isDraft,
  isCancelled,
  isInvoiceType,
  canCancelOrCredit,
  canDuplicate,
}: {
  invoiceId: string;
  isDraft: boolean;
  isCancelled: boolean;
  isInvoiceType: boolean;
  canCancelOrCredit: boolean;
  canDuplicate: boolean;
}) {
  const showConvert = !isDraft && !isCancelled && isInvoiceType;
  const showDuplicate = canDuplicate && !isDraft && !isCancelled;
  const hasAnyItem = !isDraft || showDuplicate || canCancelOrCredit || showConvert;
  if (!hasAnyItem) return null;

  return (
    <ActionMenu>
      {!isDraft && (
        <>
          <ActionMenuItem>
            <a href={`/api/invoices/${invoiceId}/xrechnung`} target="_blank" rel="noreferrer">
              XRechnung (XML)
            </a>
          </ActionMenuItem>
          <ActionMenuItem>
            <a href={`/api/invoices/${invoiceId}/zugferd`} target="_blank" rel="noreferrer">
              ZUGFeRD (PDF)
            </a>
          </ActionMenuItem>
        </>
      )}

      {showDuplicate && (
        <ActionMenuItem>
          <DuplicateInvoiceButton invoiceId={invoiceId} asMenuItem />
        </ActionMenuItem>
      )}

      {canCancelOrCredit && (
        <ActionMenuItem>
          <Link href={`/rechnungen/${invoiceId}/teilgutschrift`}>Teilgutschrift</Link>
        </ActionMenuItem>
      )}

      {canCancelOrCredit && (
        <ActionMenuItem>
          <form action={cancelAction}>
            <input type="hidden" name="id" value={invoiceId} />
            <button type="submit" className="text-rose-700">
              Stornieren
            </button>
          </form>
        </ActionMenuItem>
      )}

      {showConvert && (
        <>
          <ActionMenuSeparator />
          <ActionMenuItem>
            <ConvertMenu sourceType="INVOICE" sourceId={invoiceId} showToDeliveryNote asMenuItem />
          </ActionMenuItem>
        </>
      )}
    </ActionMenu>
  );
}
