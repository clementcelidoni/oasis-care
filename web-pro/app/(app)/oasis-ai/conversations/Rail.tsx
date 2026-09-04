"use client";

import Link from "next/link";
import { useSelectedLayoutSegment } from "next/navigation";
import { grouperParJour, titreDuFil, type FilResume } from "@/lib/ai/conversations/types";

/**
 * §11W — LE RAIL DES FILS.
 *
 * ══════════════════════════════════════════════════════════════════
 * POURQUOI GROUPER PAR JOUR PLUTÔT QU'UNE LISTE À PLAT
 * ══════════════════════════════════════════════════════════════════
 *
 * Parce que c'est la façon la moins bavarde de dire qu'il n'y a AUCUNE
 * mémoire entre deux fils. Voir « Hier » écrit au-dessus d'une
 * conversation rappelle, sans une phrase, que celle d'aujourd'hui
 * repart de zéro. Une liste à plat de titres laisserait croire à un
 * historique continu — et c'est précisément la croyance que l'ancien
 * assistant refusait d'installer, à juste titre pour l'époque.
 *
 * ─── LE JOUR EST CALCULÉ SUR LE SERVEUR ───
 *
 * « Aujourd'hui » et « Hier » arrivent en `props`. Les calculer ici
 * ferait lire l'horloge PENDANT LE RENDU, ce que le compilateur React
 * refuse — et à raison : le rendu du serveur et celui du navigateur
 * tomberaient de part et d'autre de minuit, et la liste changerait de
 * groupe sous les yeux de l'utilisateur.
 *
 * ─── POURQUOI CE COMPOSANT EST CLIENT ───
 *
 * Pour une seule chose : savoir quel fil est ouvert
 * (`useSelectedLayoutSegment`). Un layout est un composant serveur et
 * ne connaît pas l'URL de son enfant ; sans ce crochet, aucune ligne ne
 * pourrait s'afficher comme active, et l'on ne saurait pas où l'on est.
 */
export function Rail({
  fils,
  aujourdhui,
  hier,
  failed,
  migrationManquante,
}: {
  fils: FilResume[];
  aujourdhui: string;
  hier: string;
  /** La lecture a échoué. Ce n'est PAS « aucune conversation ». */
  failed: boolean;
  /** La table n'existe pas encore sur cette base. */
  migrationManquante: boolean;
}) {
  const segment = useSelectedLayoutSegment();
  const groupes = grouperParJour(fils, aujourdhui, hier);

  return (
    <nav aria-label="Vos conversations" className="flex h-full flex-col">
      {/* PREMIÈRE LIGNE, TOUJOURS VISIBLE, jamais emportée par le
          défilement. Elle NAVIGUE vers une adresse neuve plutôt que de
          vider l'écran en place : le changement d'URL est le signal le
          plus fort dont on dispose pour dire « autre objet », et le fil
          neuf ne portera aucun souvenir du précédent. */}
      <Link
        href="/oasis-ai/conversations"
        aria-current={segment === null ? "page" : undefined}
        className={`mb-3 block shrink-0 rounded-[var(--radius-control)] border px-3 py-2 text-[var(--text-body)] font-medium transition-colors ${
          segment === null
            ? "border-accent bg-accent-wash text-accent"
            : "border-line-strong bg-surface text-ink-soft hover:bg-canvas hover:text-ink"
        }`}
      >
        + Nouvelle conversation
      </Link>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {migrationManquante ? (
          /* « Réessayez dans un instant » sur une base où la table
             n'existe pas est un conseil qui ne marchera jamais. On dit
             ce qui manque. */
          <p className="rounded-[var(--radius-control)] bg-warning-wash px-3 py-2 text-[var(--text-secondary)] text-warning">
            Les conversations ne sont pas encore installées sur cette base : la migration
            0079 n&apos;a pas été appliquée. Rien de ce que vous taperez ici ne sera
            conservé tant qu&apos;elle ne l&apos;est pas.
          </p>
        ) : failed ? (
          /* « Vous n'avez aucune conversation » et « je n'ai pas pu lire
             vos conversations » ne sont pas la même phrase, et la
             seconde ne doit jamais se déguiser en la première. */
          <p className="rounded-[var(--radius-control)] bg-warning-wash px-3 py-2 text-[var(--text-secondary)] text-warning">
            Vos conversations n&apos;ont pas pu être lues. Ce n&apos;est pas
            « aucune conversation » : réessayez dans un instant.
          </p>
        ) : groupes.length === 0 ? (
          <p className="px-3 py-2 text-[var(--text-secondary)] text-ink-faint">
            Aucune conversation — celle-ci sera la première.
          </p>
        ) : (
          groupes.map((groupe) => (
            <section key={groupe.jour} className="mb-4">
              <h3 className="eyebrow mb-1.5 px-3">{groupe.libelle}</h3>
              <ul>
                {groupe.fils.map((fil) => {
                  const actif = segment === fil.id;
                  return (
                    <li key={fil.id}>
                      <Link
                        href={`/oasis-ai/conversations/${fil.id}`}
                        aria-current={actif ? "page" : undefined}
                        className={`block truncate rounded-[var(--radius-control)] px-3 py-2 text-[var(--text-body)] transition-colors ${
                          actif
                            ? "bg-accent-wash font-medium text-accent"
                            : "text-ink-soft hover:bg-canvas hover:text-ink"
                        }`}
                      >
                        {titreDuFil(fil)}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))
        )}
      </div>
    </nav>
  );
}
