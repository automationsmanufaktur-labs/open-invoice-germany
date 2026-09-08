// src/app/dokumente/[id]/_parts/DocumentMoreMenu.tsx
import Link from "next/link";
import { ActionMenuItem, ActionMenuSeparator } from "@/components/detail/ActionMenu";
import { ConvertMenu } from "@/components/ConvertMenu";

/**
 * Zusatzeintraege des "Mehr"-Menues der Dokumentdetailseite (Phase 11d, Task 4) — buendelt
 * den unveraenderten ConvertMenu (alle heutigen `show*`-Props) und den "→ zur Rechnung"-Link,
 * die zuvor in der Kopfzeile standen. Jede Option blendet sich weiterhin ueber dieselben
 * `show*`-Bedingungen ein wie zuvor; die eigentliche Pruefung bleibt serverseitig (409 bei
 * Regelverstoss, siehe ConvertMenu-Kommentar in der alten Seite).
 *
 * Fix-Welle I2: rendert seit der Kopfzeilen-Verdichtung nicht mehr sein eigenes `<ActionMenu>`
 * — der Aufrufer (`page.tsx`) baut EIN gemeinsames `<ActionMenu>` aus `DocumentActionsMenuItems`
 * (Statusuebergaenge/Archiv/Duplizieren) gefolgt von dieser Komponente; bei vorhandenem Inhalt
 * setzt sie deshalb selbst den trennenden `<ActionMenuSeparator />` an den Anfang.
 */
export function DocumentMoreMenu({
  quoteId,
  convertedToInvoiceId,
  showToOrderConfirmation,
  showToInvoice,
  showToDeliveryNote,
  showPartialInvoice,
  showDownpaymentInvoice,
  showFinalInvoice,
}: {
  quoteId: string;
  convertedToInvoiceId: string | null;
  showToOrderConfirmation: boolean;
  showToInvoice: boolean;
  showToDeliveryNote: boolean;
  showPartialInvoice: boolean;
  showDownpaymentInvoice: boolean;
  showFinalInvoice: boolean;
}) {
  const showConvert =
    showToOrderConfirmation || showToInvoice || showToDeliveryNote || showPartialInvoice || showDownpaymentInvoice || showFinalInvoice;
  const hasAnyItem = showConvert || convertedToInvoiceId != null;
  if (!hasAnyItem) return null;

  return (
    <>
      <ActionMenuSeparator />
      {convertedToInvoiceId && (
        <ActionMenuItem>
          <Link href={`/rechnungen/${convertedToInvoiceId}`}>→ zur Rechnung</Link>
        </ActionMenuItem>
      )}

      {showConvert && (
        <>
          {convertedToInvoiceId && <ActionMenuSeparator />}
          <ActionMenuItem>
            <ConvertMenu
                asMenuItem
                sourceType="QUOTE"
                sourceId={quoteId}
                showToOrderConfirmation={showToOrderConfirmation}
                showToInvoice={showToInvoice}
                showToDeliveryNote={showToDeliveryNote}
                showPartialInvoice={showPartialInvoice}
                showDownpaymentInvoice={showDownpaymentInvoice}
                showFinalInvoice={showFinalInvoice}
              />
          </ActionMenuItem>
        </>
      )}
    </>
  );
}
