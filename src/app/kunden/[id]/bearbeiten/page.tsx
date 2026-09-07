import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getActiveOrg } from "@/lib/org";
import { CustomerForm } from "@/components/forms/CustomerForm";
import { CustomerTabs } from "@/components/customers/CustomerTabs";
import { AddressesPanel } from "@/components/customers/AddressesPanel";
import { ContactsPanel } from "@/components/customers/ContactsPanel";
import { CustomerDefaultsForm } from "@/components/customers/CustomerDefaultsForm";
import { CustomFieldsForm } from "@/components/customers/CustomFieldsForm";
import { listPaymentMethods } from "@/domain/payment-method/manage";
import { listAddresses } from "@/domain/customer/addresses";
import { listContacts } from "@/domain/customer/contacts";
import { customerDefaultsFor } from "@/domain/customer/defaults";
import { listCustomFieldDefinitions, parseCustomerCustomFields } from "@/domain/customer/custom-fields";

export const dynamic = "force-dynamic";

export default async function KundeBearbeitenPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const org = await getActiveOrg();
  const customer = await prisma.customer.findFirst({ where: { id, orgId: org.id } });
  if (!customer) notFound();

  const paymentMethods = (await listPaymentMethods(org.id)).filter((m) => m.isActive || m.id === customer.defaultPaymentMethodId);

  const [addresses, contacts, defaults, definitions] = await Promise.all([
    listAddresses(org.id, id),
    listContacts(org.id, id),
    customerDefaultsFor(org.id, id),
    listCustomFieldDefinitions(org.id, { activeOnly: true }),
  ]);
  const customFieldValues = await parseCustomerCustomFields(org.id, customer.customFieldsJson);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href={`/kunden/${id}`} className="text-sm text-slate-500 hover:text-slate-800">
          ← {customer.name}
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">Kunde bearbeiten</h1>
      </div>

      <CustomerTabs
        tabs={[
          { key: "stammdaten", label: "Stammdaten", content: <CustomerForm customer={customer} paymentMethods={paymentMethods} /> },
          {
            key: "adressen",
            label: "Adressen",
            content: (
              <AddressesPanel
                customerId={id}
                initialAddresses={addresses.map((a) => ({ ...a, type: a.type as "BILLING" | "SHIPPING" | "OTHER" }))}
              />
            ),
          },
          { key: "ansprechpartner", label: "Ansprechpartner", content: <ContactsPanel customerId={id} initialContacts={contacts} /> },
          { key: "vorgaben", label: "Vorgaben", content: <CustomerDefaultsForm customerId={id} initial={defaults} /> },
          {
            key: "kundenfelder",
            label: "Kundenfelder",
            content: (
              <CustomFieldsForm
                customerId={id}
                definitions={definitions.map((d) => ({
                  id: d.id,
                  key: d.key,
                  label: d.label,
                  type: d.type as "TEXT" | "NUMBER" | "DATE" | "BOOLEAN" | "SELECT",
                  options: d.optionsJson ? (JSON.parse(d.optionsJson) as string[]) : null,
                  required: d.required,
                }))}
                initialValues={customFieldValues}
              />
            ),
          },
        ]}
      />
    </div>
  );
}
