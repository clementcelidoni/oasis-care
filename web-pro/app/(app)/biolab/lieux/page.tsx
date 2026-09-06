import Link from "next/link";
import { PageHeader, Panel, Card, Badge, StatusBadge, ButtonLink, MetricCard } from "@/components/ui";
import { Icon } from "@/components/shell/Icon";
import {
  perimetreBioLab,
  libelle,
  tonDe,
  formatNombre,
  formatDateHeure,
  formatHeure,
} from "@/lib/biolab/cultures";
import { EspaceVide, LectureImpossible, refusBioLab } from "@/lib/biolab/etats";
import {
  lireMatiereLieux,
  indexerLieux,
  rapprochements,
  resumerLieu,
  plantulesDansLeLieu,
  tonLieu,
} from "@/lib/biolab/lieux";
import {
  STATUT_BIOREACTEUR_LABELS,
  STATUT_BIOREACTEUR_TON,
  fraicheurEtat,
} from "@/lib/biolab/equipements";

/**
 * §7 « racks, salles, étagères » — OÙ SE TROUVE QUOI.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE QUE CETTE PAGE EST, ET CE QU'ELLE N'EST PAS
 * ══════════════════════════════════════════════════════════════════
 *
 * Elle N'EST PAS un plan du laboratoire, et il n'y a pas de registre
 * des salles : mesuré, aucune des vingt et une tables BioLab ne porte
 * de lieu comme objet. L'espace physique n'existe dans ce produit que
 * sous la forme de quatre colonnes de TEXTE LIBRE, tapées à la main sur
 * le téléphone — l'emplacement d'un bioréacteur, celui d'une
 * acclimatation, le rangement d'une solution mère, le nom imprimé sur
 * une étiquette de rack.
 *
 * Inventer ici une table « salles » serait le second système BioLab que
 * le §6 interdit, avec cette aggravation que personne ne l'alimenterait :
 * le téléphone ne la connaîtrait pas.
 *
 * ELLE EST donc un INDEX : elle rassemble ces quatre colonnes et répond
 * à la question du matin — qu'est-ce qui se trouve où, et qu'est-ce qui
 * n'a pas d'emplacement noté. Un lieu, ici, est un mot que quelqu'un a
 * tapé. La page le dit, parce que toutes ses limites en découlent.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE QU'ON NE PEUT PAS SAVOIR : SI UN RACK EST LIBRE
 * ══════════════════════════════════════════════════════════════════
 *
 * La question « quel rack est libre » n'a pas de réponse dans ce
 * modèle, et il faut le dire au lieu de la contourner. Une étiquette de
 * rack ne porte AUCUN lien vers un lot ou un bocal — le module mobile
 * l'écrit noir sur blanc : « elle n'ouvre aucune fiche ». Le produit
 * sait qu'un rack porte un nom et quand on l'a scanné ; il ne sait pas
 * ce qui est posé dessus. Afficher « rack libre » serait une invention
 * pure, et sur ce genre d'affirmation on déplace des bocaux.
 */
export default async function LieuxBioLabPage() {
  const perimetre = await perimetreBioLab();
  // Un seul garde pour les deux refus possibles : le droit manquant
  // et le module que l'entreprise a éteint (§43). Voir lib/biolab/etats.tsx.
  const refus = refusBioLab(perimetre, "Le plan des lieux");

  if (refus) {
    return (
      <div className="mx-auto max-w-5xl px-8 py-10">
        <PageHeader title="Lieux" subtitle="Où se trouve quoi dans le laboratoire." />
        {refus}
      </div>
    );
  }

  const maintenant = new Date();
  const lecture = await lireMatiereLieux(perimetre.workspaceId);

  if (lecture.erreur) {
    // Un plan des lieux bâti sur trois sources au lieu de quatre
    // situerait faussement le laboratoire sans rien signaler. « Rien à
    // situer » et « la lecture a échoué » ne se confondent pas.
    return (
      <div className="mx-auto max-w-5xl px-8 py-10">
        <PageHeader title="Lieux" subtitle="Où se trouve quoi dans le laboratoire." />
        <LectureImpossible sujet="Le plan des lieux" erreur={lecture.erreur} />
      </div>
    );
  }

  const index = indexerLieux(lecture.matiere);
  const paires = rapprochements(index.lieux);

  const totalObjets = index.situes + index.nonSitues;
  const racksEtiquetes = index.lieux.reduce((total, lieu) => total + lieu.racks.length, 0);

  return (
    <div className="mx-auto max-w-6xl px-8 py-10">
      <PageHeader
        title="Lieux"
        subtitle="Où se trouvent les bioréacteurs, les acclimatations en cours et les solutions mères."
        action={
          <ButtonLink href="/biolab/equipements" variant="secondary">
            Voir les équipements
          </ButtonLink>
        }
      />

      {totalObjets === 0 && racksEtiquetes === 0 ? (
        <EspaceVide
          quoi="Rien à situer dans l'espace de cette entreprise"
          aQuoiCaSert="Cette page rassemblera les emplacements notés sur les bioréacteurs, les acclimatations et les solutions mères, pour dire ce qui se trouve où."
        />
      ) : (
        <>
          <section className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <MetricCard
              label="Lieux distincts"
              value={formatNombre(index.lieux.length)}
              hint="Tels qu'ils ont été tapés"
            />
            <MetricCard
              label="Objets situés"
              value={formatNombre(index.situes)}
              hint={`sur ${formatNombre(totalObjets)} au total`}
              tone="accent"
            />
            <MetricCard
              label="Sans emplacement"
              value={formatNombre(index.nonSitues)}
              hint="Introuvables sans demander"
              tone={index.nonSitues > 0 ? "warning" : "neutral"}
            />
            <MetricCard
              label="Racks étiquetés"
              value={formatNombre(racksEtiquetes)}
              hint="Un nom imprimé, rien de plus"
            />
          </section>

          {/* -----------------------------------------------------------
              LA MISE EN GARDE SUR LA NATURE MÊME DE CETTE PAGE.
              Elle vient avant les données, pas après : quelqu'un qui
              lirait « 3 lieux » sans savoir que ce sont trois mots
              tapés à la main en tirerait de fausses conclusions.
             ----------------------------------------------------------- */}
          <Card className="mb-5 flex items-start gap-3 px-5 py-4">
            <Icon name="locations" className="mt-0.5 h-5 w-5 shrink-0 text-ink-soft" />
            <p className="text-[var(--text-body)] text-ink-soft">
              <strong className="text-ink">Un lieu est un mot, pas une fiche.</strong> Ce produit
              n&apos;a pas de registre des salles ni des étagères : les emplacements sont saisis
              en texte libre sur le téléphone, et cette page les regroupe. Deux orthographes
              différentes feront donc deux lieux — la casse et les accents sont ignorés, le reste
              non.
            </p>
          </Card>

          {paires.length > 0 && (
            <Panel
              title="Ces noms désignent peut-être le même endroit"
              description="Une remarque, pas une correction : rien n'a été regroupé."
              className="mb-5"
            >
              <ul className="divide-y divide-line">
                {paires.map((paire) => (
                  <li key={`${paire.a}-${paire.b}`} className="px-5 py-3 text-[var(--text-body)]">
                    <strong>{paire.a}</strong> et <strong>{paire.b}</strong>
                    <span className="ml-2 text-ink-soft">
                      — si c&apos;est bien le même endroit, corrigez la saisie sur le téléphone
                      pour que les deux se rejoignent ici.
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          {/* -----------------------------------------------------------
              CE QUI N'A PAS D'EMPLACEMENT — en premier, parce que c'est
              la seule chose actionnable de la page. Un objet sans lieu
              noté est un objet qu'on ne trouve qu'en demandant.
             ----------------------------------------------------------- */}
          {index.nonSitues > 0 && (
            <Panel
              title="Sans emplacement noté"
              description="Rien ne dit où les trouver."
              count={index.nonSitues}
              className="mb-5"
            >
              <ul className="divide-y divide-line">
                {index.sansEmplacement.bioreacteurs.map((bioreacteur) => (
                  <li
                    key={bioreacteur.id}
                    className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
                  >
                    <span>
                      <Badge tone="neutral">Bioréacteur</Badge>{" "}
                      <Link
                        href={`/biolab/equipements/${bioreacteur.id}`}
                        className="font-medium text-accent hover:underline"
                      >
                        {bioreacteur.code ?? bioreacteur.name ?? "Sans code"}
                      </Link>
                    </span>
                    <span className="text-[var(--text-secondary)] text-ink-faint">
                      Emplacement à renseigner sur le téléphone
                    </span>
                  </li>
                ))}
                {index.sansEmplacement.acclimatations.map((acclimatation) => (
                  <li key={acclimatation.id} className="px-5 py-3">
                    <Badge tone="neutral">Acclimatation</Badge>{" "}
                    <span className="font-medium">{acclimatation.lot_code ?? "Lot inconnu"}</span>
                    <span className="ml-2 text-ink-soft">
                      {formatNombre(acclimatation.current_survivor_count)} plantule
                      {(acclimatation.current_survivor_count ?? 0) > 1 ? "s" : ""} vivante
                      {(acclimatation.current_survivor_count ?? 0) > 1 ? "s" : ""}
                    </span>
                  </li>
                ))}
                {index.sansEmplacement.solutions.map((solution) => (
                  <li key={solution.id} className="px-5 py-3">
                    <Badge tone="neutral">Solution mère</Badge>{" "}
                    <span className="font-medium">{solution.name ?? "Sans nom"}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          {/* -----------------------------------------------------------
              LES LIEUX, DU PLUS OCCUPÉ AU MOINS OCCUPÉ.
             ----------------------------------------------------------- */}
          {index.lieux.length > 0 && (
            <div className="grid gap-4 lg:grid-cols-2">
              {index.lieux.map((lieu) => {
                const resume = resumerLieu(lieu);
                const plantules = plantulesDansLeLieu(lieu);

                return (
                  <Card key={lieu.clef} className="p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[length:var(--text-card)] font-semibold">{lieu.nom}</p>
                        {lieu.variantes.length > 0 && (
                          /* On montre les autres graphies rencontrées :
                             c'est ce qui permet de comprendre pourquoi
                             deux saisies ont été regroupées. */
                          <p className="mt-0.5 text-[var(--text-secondary)] text-ink-faint">
                            Aussi saisi : {lieu.variantes.join(", ")}
                          </p>
                        )}
                      </div>
                      {lieu.occupants > 0 && (
                        <StatusBadge tone={tonLieu(lieu)}>
                          {lieu.occupants} occupant{lieu.occupants > 1 ? "s" : ""}
                        </StatusBadge>
                      )}
                    </div>

                    {resume && (
                      <p className="mt-2 text-[var(--text-body)] text-ink-soft">{resume}</p>
                    )}

                    {lieu.bioreacteurs.length > 0 && (
                      <div className="mt-4 border-t border-line pt-3">
                        <p className="eyebrow mb-2">Bioréacteurs</p>
                        <ul className="space-y-1.5">
                          {lieu.bioreacteurs.map((bioreacteur) => (
                            <li
                              key={bioreacteur.id}
                              className="flex flex-wrap items-center justify-between gap-2 text-[var(--text-body)]"
                            >
                              <Link
                                href={`/biolab/equipements/${bioreacteur.id}`}
                                className="font-medium text-accent hover:underline"
                              >
                                {bioreacteur.code ?? bioreacteur.name ?? "Sans code"}
                              </Link>
                              {/* L'ÉTAT EST DATÉ ICI AUSSI, ET C'EST
                                  UNE CORRECTION. Cette page affichait
                                  « Immersion », « Défaut », « Au
                                  repos » comme des faits présents, sans
                                  jamais dire de quand l'information
                                  datait — alors que la colonne était
                                  déjà chargée. Mesuré en production :
                                  l'unique bioréacteur porte un état
                                  écrit il y a plusieurs jours. « Page
                                  lue à 10:14 » en pied de page ne
                                  rattrape rien : elle date le RENDU,
                                  pas le relevé, et c'est précisément la
                                  confusion contre laquelle l'écran des
                                  équipements a été écrit. */}
                              <span className="flex flex-wrap items-center gap-2">
                                <StatusBadge
                                  tone={tonDe(STATUT_BIOREACTEUR_TON, bioreacteur.status)}
                                >
                                  {libelle(STATUT_BIOREACTEUR_LABELS, bioreacteur.status)}
                                </StatusBadge>
                                {(() => {
                                  const f = fraicheurEtat(bioreacteur.updated_at, maintenant);
                                  return (
                                    <span
                                      className={f.ancien ? "text-warning" : "text-ink-faint"}
                                      title={
                                        f.ancien
                                          ? "Cette ligne n'a pas été réécrite depuis plus d'une journée : l'appareil peut être à l'arrêt, ou le téléphone ne plus synchroniser. À vérifier sur place."
                                          : undefined
                                      }
                                    >
                                      {f.texte}
                                    </span>
                                  );
                                })()}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {lieu.acclimatations.length > 0 && (
                      <div className="mt-4 border-t border-line pt-3">
                        <p className="eyebrow mb-2">
                          Acclimatation — {formatNombre(plantules)} plantule
                          {plantules > 1 ? "s" : ""} vivante{plantules > 1 ? "s" : ""}
                        </p>
                        <ul className="space-y-1.5">
                          {lieu.acclimatations.map((acclimatation) => (
                            <li
                              key={acclimatation.id}
                              className="flex flex-wrap items-center justify-between gap-2 text-[var(--text-body)]"
                            >
                              <span className="font-medium">
                                {acclimatation.lot_code ?? "Lot inconnu"}
                              </span>
                              <span className="tabular text-ink-soft">
                                {formatNombre(acclimatation.current_survivor_count)} sur{" "}
                                {formatNombre(acclimatation.initial_plantlet_count)} au départ
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {lieu.solutions.length > 0 && (
                      <div className="mt-4 border-t border-line pt-3">
                        <p className="eyebrow mb-2">Solutions mères rangées ici</p>
                        <ul className="space-y-1.5">
                          {lieu.solutions.map((solution) => (
                            <li
                              key={solution.id}
                              className="flex flex-wrap items-center justify-between gap-2 text-[var(--text-body)]"
                            >
                              <span>{solution.name ?? "Sans nom"}</span>
                              {solution.expires_at && (
                                <span className="text-ink-faint">
                                  jusqu&apos;au {formatDateHeure(solution.expires_at)}
                                </span>
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {lieu.racks.length > 0 && (
                      <div className="mt-4 border-t border-line pt-3">
                        <p className="eyebrow mb-2">Étiquette imprimée</p>
                        <div className="flex flex-wrap items-center gap-2 text-[var(--text-body)]">
                          {lieu.racks.map((rack) => (
                            <Badge key={rack.id} tone={rack.active ? "info" : "neutral"}>
                              {rack.type === "nfc" ? "NFC" : "QR"}
                              {rack.last_scanned_at
                                ? ` · scanné ${formatDateHeure(rack.last_scanned_at)}`
                                : " · jamais scanné"}
                            </Badge>
                          ))}
                        </div>
                        {/* LA PHRASE QUI ÉVITE LA FAUSSE CERTITUDE. */}
                        <p className="mt-2 text-[var(--text-secondary)] text-ink-faint">
                          Une étiquette de rack est un repère physique : elle porte un nom, elle
                          n&apos;enregistre pas ce qui est posé dessus. Le web ne peut donc pas
                          dire si ce rack est libre.
                        </p>
                      </div>
                    )}

                    {lieu.occupants === 0 && lieu.racks.length > 0 && (
                      <p className="mt-3 text-[var(--text-secondary)] text-ink-faint">
                        Aucun bioréacteur, aucune acclimatation et aucune solution mère
                        n&apos;indique cet emplacement. Cela ne veut pas dire que l&apos;endroit
                        est vide — seulement que rien ne le déclare.
                      </p>
                    )}
                  </Card>
                );
              })}
            </div>
          )}
        </>
      )}

      <p className="mt-6 text-[var(--text-secondary)] text-ink-faint">
        Page lue à {formatHeure(maintenant)} — l&apos;état de chaque appareil, lui, porte sa
        propre date ci-dessus. Les emplacements se saisissent depuis l&apos;application mobile ;
        ils apparaissent ici au rechargement suivant.
      </p>
    </div>
  );
}
