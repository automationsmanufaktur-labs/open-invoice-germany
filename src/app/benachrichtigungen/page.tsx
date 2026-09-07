import { getActiveOrg } from "@/lib/org";
import { listNotifications } from "@/domain/notifications/create";
import { NotificationsList } from "@/components/NotificationsList";

export const dynamic = "force-dynamic";

/** Task 4: `/benachrichtigungen` — vollstaendige Liste (nicht nur die letzten 10 der Glocke). */
export default async function BenachrichtigungenPage() {
  const org = await getActiveOrg();
  const notifications = await listNotifications(org.id, { limit: 100 });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Benachrichtigungen</h1>
      <NotificationsList
        initial={notifications.map((n) => ({
          id: n.id,
          type: n.type,
          title: n.title,
          body: n.body,
          link: n.link,
          createdAt: n.createdAt.toISOString(),
          readAt: n.readAt ? n.readAt.toISOString() : null,
        }))}
      />
    </div>
  );
}
