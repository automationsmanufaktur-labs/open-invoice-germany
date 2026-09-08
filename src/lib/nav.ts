// src/lib/nav.ts
/**
 * Navigationsmodell der App-Shell (Phase 11a). Reine Daten + Pfadlogik, keine React-
 * Abhaengigkeit — damit die aktive Erkennung unit-testbar ist. Gruppen und Reihenfolge
 * laut Spec Phase 11 (Abschnitt 2, "Navigation").
 */
export type NavIconName =
  | "home" | "quote" | "order" | "delivery" | "invoice" | "credit" | "recurring" | "dunning"
  | "customer" | "product" | "mail" | "bell" | "settings" | "search" | "menu" | "close"
  | "logout" | "chevron-left" | "chevron-right";

export interface NavItem {
  href: string;
  label: string;
  icon?: NavIconName;
  /** true: nur exakter Pfad (ohne Unterpfade) gilt als aktiv. */
  exact?: boolean;
  /** Zeigt den Ungelesen-Zaehler der Benachrichtigungen. */
  badge?: "notifications";
}

export interface NavGroup {
  key: string;
  label: string;
  icon: NavIconName;
  /** Gruppe ist selbst ein Link (Uebersicht) und hat keine Unterpunkte. */
  href?: string;
  items: NavItem[];
}

/** Stabiler Schluessel je Einstellungen-Unterseite — Grundlage fuer `SettingsTabs`/`SettingsTabKey`
 *  (Phase 11b, Task 7): `SettingsTabs` leitet seine Reiter aus `SETTINGS_ITEMS` ab statt eine
 *  eigene, parallel gepflegte Liste zu fuehren. */
export const SETTINGS_KEYS = [
  "stammdaten",
  "belege",
  "nummernkreise",
  "briefpapier",
  "marke",
  "email",
  "vorlagen",
  "textvorlagen",
  "zahlungsmethoden",
  "mahnwesen",
  "kundenfelder",
  "benachrichtigungen",
  "automatisierung",
  "api",
  "webhooks",
] as const;
export type SettingsKey = (typeof SETTINGS_KEYS)[number];

export interface SettingsNavItem extends NavItem {
  key: SettingsKey;
}

export const NAV_GROUPS: readonly NavGroup[] = [
  { key: "home", label: "Übersicht", icon: "home", href: "/", items: [] },
  {
    key: "verkauf",
    label: "Verkauf",
    icon: "invoice",
    items: [
      { href: "/dokumente?kind=ANGEBOT", label: "Angebote", icon: "quote" },
      { href: "/dokumente?kind=AUFTRAGSBESTAETIGUNG", label: "Auftragsbestätigungen", icon: "order" },
      { href: "/dokumente?kind=PROFORMA", label: "Proforma", icon: "quote" },
      { href: "/lieferscheine", label: "Lieferscheine", icon: "delivery" },
      { href: "/rechnungen", label: "Rechnungen", icon: "invoice" },
      { href: "/rechnungen?type=CREDIT_NOTE", label: "Gutschriften", icon: "credit" },
      { href: "/abos", label: "Wiederkehrend", icon: "recurring" },
      { href: "/mahnwesen", label: "Mahnwesen", icon: "dunning" },
    ],
  },
  {
    key: "verwaltung",
    label: "Verwaltung",
    icon: "settings",
    items: [
      { href: "/kunden", label: "Kunden", icon: "customer" },
      { href: "/produkte", label: "Produkte", icon: "product" },
      { href: "/benachrichtigungen", label: "Benachrichtigungen", icon: "bell", badge: "notifications" },
      { href: "/einstellungen", label: "Einstellungen", icon: "settings" },
    ],
  },
];

/**
 * Unterpunkte der Einstellungen (werden unter "Einstellungen" eingeblendet, wenn aktiv,
 * und liefern die Reiter der Briefpapier-/Einstellungen-Seiten via `SettingsTabs`).
 *
 * `/einstellungen/druckoptionen` ist seit Phase 11b Task 7 kein eigener Reiter mehr —
 * die Seite leitet auf `/einstellungen/briefpapier?tab=druckoptionen` um (Reiter dort).
 * `/einstellungen/dokumente` war schon seit Phase 7 (§33) kein eigener Reiter: die Seite
 * ist dort bereits zu einem reinen Redirect auf `/einstellungen/belege` geworden (die
 * Funktion ging im Tab "Belege" auf) und hat seither keinen eigenen Titel/Inhalt mehr —
 * sie bleibt bewusst aussen vor, um keinen zweiten, sofort weiterleitenden Reiter zu zeigen.
 */
export const SETTINGS_ITEMS: readonly SettingsNavItem[] = [
  { href: "/einstellungen", label: "Stammdaten", key: "stammdaten", exact: true },
  { href: "/einstellungen/belege", label: "Belege", key: "belege" },
  { href: "/einstellungen/nummernkreise", label: "Nummernkreise", key: "nummernkreise" },
  { href: "/einstellungen/briefpapier", label: "Briefpapier", key: "briefpapier" },
  { href: "/einstellungen/marke", label: "Marke", key: "marke" },
  { href: "/einstellungen/email", label: "E-Mail-Versand", key: "email" },
  { href: "/einstellungen/vorlagen", label: "Textvorlagen", key: "vorlagen" },
  { href: "/einstellungen/textvorlagen", label: "Dokumenttexte", key: "textvorlagen" },
  { href: "/einstellungen/zahlungsmethoden", label: "Zahlungsmethoden", key: "zahlungsmethoden" },
  { href: "/einstellungen/mahnwesen", label: "Mahnwesen", key: "mahnwesen" },
  { href: "/einstellungen/kundenfelder", label: "Kundenfelder", key: "kundenfelder" },
  { href: "/einstellungen/benachrichtigungen", label: "Benachrichtigungen", key: "benachrichtigungen" },
  { href: "/einstellungen/automatisierung", label: "Automatisierung", key: "automatisierung" },
  { href: "/einstellungen/api", label: "API", key: "api" },
  { href: "/einstellungen/webhooks", label: "Webhooks", key: "webhooks" },
];

function splitHref(href: string): { path: string; params: URLSearchParams } {
  const [path, query = ""] = href.split("?");
  return { path, params: new URLSearchParams(query) };
}

/**
 * Ein Item ist aktiv, wenn der Pfad gleich ist oder (ohne `exact`) darunter liegt UND
 * alle Query-Parameter des Items in der aktuellen Query stehen. Items OHNE Query gelten
 * nur, wenn die aktuelle Query KEINEN der Parameter setzt, die ein Geschwister-Item mit
 * gleichem Pfad nutzt (sonst waeren "Rechnungen" und "Gutschriften" gleichzeitig aktiv).
 * Ausnahme: `/dokumente` ohne `kind` zaehlt als "Angebote" (Default der Liste).
 */
export function itemMatches(item: NavItem, pathname: string, search: string): boolean {
  const { path, params } = splitHref(item.href);
  const current = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const pathOk = item.exact ? pathname === path : pathname === path || pathname.startsWith(path + "/");
  if (!pathOk) return false;

  if ([...params.keys()].length > 0) {
    for (const [k, v] of params) {
      const cur = current.get(k);
      if (cur === v) continue;
      if (k === "kind" && v === "ANGEBOT" && cur === null) continue; // Default der Dokumentliste
      return false;
    }
    return true;
  }
  // Item ohne Query: nicht aktiv, wenn ein Geschwister mit gleichem Pfad ueber Query matcht.
  const siblings = NAV_GROUPS.flatMap((g) => g.items).filter((s) => s !== item && splitHref(s.href).path === path);
  return !siblings.some((s) => [...splitHref(s.href).params].some(([k, v]) => current.get(k) === v));
}

export function activeGroupKey(pathname: string, search: string): string | null {
  for (const g of NAV_GROUPS) {
    if (g.href !== undefined && g.items.length === 0) {
      if (pathname === g.href) return g.key;
      continue;
    }
    if (g.items.some((i) => itemMatches(i, pathname, search))) return g.key;
  }
  return null;
}
