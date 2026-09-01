"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon, type IconName } from "./Icon";
import {
  SEARCH_GROUPS, SEARCH_FILTERS, ENTITY_LABELS, matchCommands, parseQuery,
  type SearchResult, type EntityType,
} from "@/lib/search/types";

/**
 * §20 OASIS GLOBAL SEARCH — « FONCTION MAJEURE », et §51 « l'un des
 * moyens principaux de navigation ».
 *
 * Ce que ce composant doit tenir, pris dans la spec :
 *
 *  §20 visible en permanence dans le header, ⌘K / Ctrl+K ;
 *  §22 grande palette, résultats GROUPÉS, « Voir tous les résultats » ;
 *  §23 cliquer ouvre directement la fiche ;
 *  §25 filtres par famille ;
 *  §27 recherches récentes et éléments récemment ouverts ;
 *  §28 favoris ;
 *  §29 palette de COMMANDES — « nouveau devis » propose de le créer ;
 *  §31 debounce 150–250 ms, et annulation des requêtes périmées.
 *
 * Le point le plus facile à rater est le dernier. Sans `AbortController`,
 * la réponse la plus LENTE écrase la plus récente, et les résultats
 * clignotent entre deux frappes — un défaut qu'on attribue au réseau
 * alors qu'il vient d'ici.
 */

type QuickItem = {
  id: string;
  title: string;
  url: string;
  entity_type: string;
};

type Option = {
  key: string;
  label: string;
  hint?: string | null;
  url: string;
  icon: IconName;
  /** Ce qu'on enregistrera comme « récemment ouvert », si c'en est un. */
  record?: { entityType: string; entityId: string; title: string };
};

const DEBOUNCE_MS = 200;

export function GlobalSearch({
  recents,
  favorites,
  recordOpen,
}: {
  recents: QuickItem[];
  favorites: QuickItem[];
  recordOpen: (formData: FormData) => void | Promise<void>;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("tout");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [cursor, setCursor] = useState(0);

  // ---- ouverture -------------------------------------------------
  const show = useCallback(() => setOpen(true), []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      // §20 « Cmd + K / Ctrl + K ».
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((current) => !current);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      inputRef.current?.focus();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const onClose = () => {
      setOpen(false);
      setQuery("");
      setResults([]);
      setCursor(0);
    };
    dialog.addEventListener("close", onClose);
    return () => dialog.removeEventListener("close", onClose);
  }, []);

  // ---- §31 recherche : debounce + annulation ---------------------
  useEffect(() => {
    const parsed = parseQuery(query);
    if (parsed.text.trim().length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);

    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/recherche?q=${encodeURIComponent(query)}`, {
          signal: controller.signal,
        });
        const payload = (await response.json()) as { results: SearchResult[] };
        setResults(payload.results ?? []);
        setCursor(0);
      } catch {
        // Une requête annulée n'est pas une panne : c'est le
        // fonctionnement normal quand on continue de taper.
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  // ---- ce qu'on affiche ------------------------------------------
  const activeFilter = SEARCH_FILTERS.find((f) => f.key === filter) ?? SEARCH_FILTERS[0];

  const shown = useMemo(
    () =>
      activeFilter.types === null
        ? results
        : results.filter((r) => activeFilter.types!.includes(r.entity_type)),
    [results, activeFilter],
  );

  const commands = useMemo(() => (query.trim() ? matchCommands(query) : []), [query]);

  const groups = useMemo(
    () =>
      SEARCH_GROUPS.map((group) => ({
        ...group,
        rows: shown.filter((r) => group.types.includes(r.entity_type)),
      })).filter((group) => group.rows.length > 0),
    [shown],
  );

  const empty = query.trim().length < 2;

  /** L'ordre des flèches : commandes, puis chaque groupe dans l'ordre. */
  const options = useMemo<Option[]>(() => {
    if (empty) {
      return [
        ...favorites.map((item) => ({
          key: `fav-${item.id}`,
          label: item.title,
          hint: ENTITY_LABELS[item.entity_type as EntityType] ?? null,
          url: item.url,
          icon: "check" as IconName,
        })),
        ...recents.map((item) => ({
          key: `rec-${item.id}`,
          label: item.title,
          hint: ENTITY_LABELS[item.entity_type as EntityType] ?? null,
          url: item.url,
          icon: "chevron" as IconName,
        })),
      ];
    }
    return [
      ...commands.map((command) => ({
        key: `cmd-${command.id}`,
        label: command.label,
        hint: command.hint ?? "Commande",
        url: command.url,
        icon: command.icon,
      })),
      ...groups.flatMap((group) =>
        group.rows.map((row) => ({
          key: `${row.entity_type}-${row.entity_id}`,
          label: row.title,
          hint: row.subtitle,
          url: row.url,
          icon: row.icon,
          record: {
            entityType: row.entity_type,
            entityId: row.entity_id,
            title: row.title,
          },
        })),
      ),
    ];
  }, [empty, favorites, recents, commands, groups]);

  const go = useCallback(
    (option: Option) => {
      // §23 OUVERTURE DIRECTE. On enregistre l'ouverture AVANT de
      // naviguer, sans l'attendre : la navigation ne doit pas dépendre
      // d'une écriture de confort.
      if (option.record) {
        const form = new FormData();
        form.set("entity_type", option.record.entityType);
        form.set("entity_id", option.record.entityId);
        form.set("title", option.record.title);
        form.set("url", option.url);
        void recordOpen(form);
      }
      dialogRef.current?.close();
      router.push(option.url);
    },
    [recordOpen, router],
  );

  function onKeyDown(event: React.KeyboardEvent) {
    if (options.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setCursor((c) => (c + 1) % options.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setCursor((c) => (c - 1 + options.length) % options.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const option = options[cursor];
      if (option) go(option);
    }
  }

  let index = -1;
  const nextIndex = () => (index += 1);

  return (
    <>
      {/* §4 — la barre est visible en permanence dans le header. Ce
          n'est pas un vrai champ : cliquer ouvre la palette, qui est le
          seul endroit où l'on tape. Deux champs de saisie superposés
          feraient perdre le focus à chaque ouverture. */}
      <button
        type="button"
        onClick={show}
        className="flex min-w-0 flex-1 items-center gap-2.5 rounded-[var(--radius-control)] border border-line bg-surface-sunken px-3 py-1.5 text-left text-[var(--text-secondary)] text-ink-faint transition-colors hover:border-line-strong hover:bg-surface"
      >
        <Icon name="search" className="h-4 w-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate">Rechercher dans Oasis Care Pro…</span>
        <kbd className="hidden shrink-0 rounded border border-line-strong bg-surface px-1.5 py-0.5 font-sans text-[11px] text-ink-faint sm:block">
          ⌘K
        </kbd>
      </button>

      <dialog
        ref={dialogRef}
        aria-label="Recherche globale"
        onClick={(event) => {
          if (event.target === dialogRef.current) dialogRef.current?.close();
        }}
        className="mx-auto mb-auto mt-[8vh] w-[calc(100vw-2rem)] max-w-2xl rounded-[var(--radius-card)] border border-line bg-surface p-0 text-ink shadow-[var(--shadow-float)] backdrop:bg-ink/40 backdrop:backdrop-blur-[2px]"
      >
        <div className="rise flex max-h-[70vh] flex-col">
          <div className="flex items-center gap-3 border-b border-line px-4 py-3">
            <Icon name="search" className="h-5 w-5 shrink-0 text-ink-faint" />
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Client, devis, facture, lot, objet du plan…"
              aria-label="Rechercher"
              aria-controls={listId}
              autoComplete="off"
              className="min-w-0 flex-1 bg-transparent text-[length:var(--text-card)] outline-none placeholder:text-ink-faint"
            />
            {loading && <span className="skeleton h-2 w-10 shrink-0 rounded-full" />}
            <kbd className="hidden shrink-0 rounded border border-line-strong bg-canvas px-1.5 py-0.5 font-sans text-[11px] text-ink-faint sm:block">
              Échap
            </kbd>
          </div>

          {/* §25 FILTRES RECHERCHE. */}
          {!empty && (
            <div className="flex gap-1 overflow-x-auto border-b border-line px-3 py-2">
              {SEARCH_FILTERS.map((option) => {
                const count =
                  option.types === null
                    ? results.length
                    : results.filter((r) => option.types!.includes(r.entity_type)).length;
                if (option.types !== null && count === 0) return null;
                return (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => setFilter(option.key)}
                    aria-pressed={filter === option.key}
                    className={`shrink-0 rounded-[var(--radius-pill)] px-2.5 py-1 text-[12px] transition-colors ${
                      filter === option.key
                        ? "bg-accent text-accent-ink"
                        : "text-ink-soft hover:bg-canvas"
                    }`}
                  >
                    {option.label}
                    <span className="tabular ml-1.5 opacity-70">{count}</span>
                  </button>
                );
              })}
            </div>
          )}

          <div id={listId} className="flex-1 overflow-y-auto px-2 py-2">
            {empty ? (
              <>
                {favorites.length > 0 && (
                  <Group label="Favoris">
                    {favorites.map((item) => (
                      <Row
                        key={item.id}
                        index={nextIndex()}
                        cursor={cursor}
                        setCursor={setCursor}
                        icon="check"
                        label={item.title}
                        hint={ENTITY_LABELS[item.entity_type as EntityType]}
                        onSelect={() => go({ key: item.id, label: item.title, url: item.url, icon: "check" })}
                      />
                    ))}
                  </Group>
                )}

                {recents.length > 0 && (
                  <Group label="Récemment ouverts">
                    {recents.map((item) => (
                      <Row
                        key={item.id}
                        index={nextIndex()}
                        cursor={cursor}
                        setCursor={setCursor}
                        icon="chevron"
                        label={item.title}
                        hint={ENTITY_LABELS[item.entity_type as EntityType]}
                        onSelect={() => go({ key: item.id, label: item.title, url: item.url, icon: "chevron" })}
                      />
                    ))}
                  </Group>
                )}

                {favorites.length === 0 && recents.length === 0 && (
                  <p className="px-3 py-8 text-center text-[var(--text-body)] text-ink-faint">
                    Cherchez un client, un devis, une facture, un lot — ou même un
                    arbre posé sur un plan.
                  </p>
                )}
              </>
            ) : (
              <>
                {/* §29 — les commandes d'abord, dans leur propre groupe.
                    Mêlées aux résultats, on créerait un devis en croyant
                    en ouvrir un. */}
                {commands.length > 0 && (
                  <Group label="Actions">
                    {commands.map((command) => (
                      <Row
                        key={command.id}
                        index={nextIndex()}
                        cursor={cursor}
                        setCursor={setCursor}
                        icon={command.icon}
                        label={command.label}
                        hint={command.hint}
                        accent
                        onSelect={() =>
                          go({ key: command.id, label: command.label, url: command.url, icon: command.icon })
                        }
                      />
                    ))}
                  </Group>
                )}

                {groups.map((group) => (
                  <Group key={group.key} label={group.label}>
                    {group.rows.map((row) => (
                      <Row
                        key={`${row.entity_type}-${row.entity_id}`}
                        index={nextIndex()}
                        cursor={cursor}
                        setCursor={setCursor}
                        icon={row.icon}
                        label={row.title}
                        hint={row.subtitle}
                        badge={ENTITY_LABELS[row.entity_type]}
                        onSelect={() =>
                          go({
                            key: row.entity_id,
                            label: row.title,
                            url: row.url,
                            icon: row.icon,
                            record: {
                              entityType: row.entity_type,
                              entityId: row.entity_id,
                              title: row.title,
                            },
                          })
                        }
                      />
                    ))}
                  </Group>
                ))}

                {!loading && groups.length === 0 && commands.length === 0 && (
                  <div className="px-3 py-8 text-center">
                    <p className="text-[var(--text-body)]">
                      Rien ne correspond à « {query} ».
                    </p>
                    <p className="mt-1 text-[var(--text-secondary)] text-ink-faint">
                      Essayez un nom, un numéro de devis, un téléphone — ou{" "}
                      <span className="font-mono">type:devis</span> pour ne chercher
                      que là.
                    </p>
                  </div>
                )}
              </>
            )}
          </div>

          {/* §22 « Voir tous les résultats ». La palette en montre six
              par famille ; la page de recherche les montre tous. */}
          {!empty && shown.length > 0 && (
            <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-2.5">
              <p className="text-[var(--text-secondary)] text-ink-faint">
                ↑↓ pour parcourir · ↵ pour ouvrir
              </p>
              <button
                type="button"
                onClick={() => {
                  dialogRef.current?.close();
                  router.push(`/recherche?q=${encodeURIComponent(query)}`);
                }}
                className="text-[var(--text-secondary)] font-medium text-accent hover:underline"
              >
                Voir tous les résultats
              </button>
            </div>
          )}
        </div>
      </dialog>
    </>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-2 last:mb-0">
      <p className="eyebrow px-3 py-1.5">{label}</p>
      <div className="flex flex-col">{children}</div>
    </div>
  );
}

function Row({
  index, cursor, setCursor, icon, label, hint, badge, accent = false, onSelect,
}: {
  index: number;
  cursor: number;
  setCursor: (n: number) => void;
  icon: IconName;
  label: string;
  hint?: string | null;
  badge?: string;
  accent?: boolean;
  onSelect: () => void;
}) {
  const active = index === cursor;
  return (
    <button
      type="button"
      onMouseMove={() => setCursor(index)}
      onClick={onSelect}
      aria-selected={active}
      className={`flex w-full items-center gap-3 rounded-[var(--radius-control)] px-3 py-2 text-left transition-colors ${
        active ? "bg-accent-wash" : ""
      }`}
    >
      <Icon
        name={icon}
        className={`h-4 w-4 shrink-0 ${accent || active ? "text-accent" : "text-ink-faint"}`}
      />
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-[var(--text-body)] ${accent ? "font-medium" : ""}`}>
          {label}
        </span>
        {hint && (
          <span className="block truncate text-[var(--text-secondary)] text-ink-faint">{hint}</span>
        )}
      </span>
      {badge && (
        <span className="shrink-0 rounded bg-surface-sunken px-1.5 py-0.5 text-[11px] text-ink-faint">
          {badge}
        </span>
      )}
    </button>
  );
}
