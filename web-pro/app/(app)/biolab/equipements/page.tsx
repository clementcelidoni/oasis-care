import Link from "next/link";
import { PageHeader, Panel, Card, StatusBadge, Badge, ButtonLink } from "@/components/ui";
import { Icon } from "@/components/shell/Icon";
import {
  perimetreBioLab,
  libelle,
  tonDe,
  formatDateHeure,
  formatHeure,
} from "@/lib/biolab/cultures";
import { EspaceVide, LectureImpossible, refusBioLab } from "@/lib/biolab/etats";
import {
  lireSupervision,
  fraicheurEtat,
  direObjets,
  STATUT_BIOREACTEUR_LABELS,
  STATUT_BIOREACTEUR_TON,
  TYPE_BIOREACTEUR_LABELS,
  CYCLE_LABELS,
  STATUT_CYCLE_LABELS,
  STATUT_CYCLE_TON,
} from "@/lib/biolab/equipements";

/**
 * §7 — LE TABLEAU DE SUPERVISION DES ÉQUIPEMENTS.
 *
 * ══════════════════════════════════════════════════════════════════
 * CETTE PAGE NE COMMANDE RIEN, ET ELLE LE DIT
 * ══════════════════════════════════════════════════════════════════
 *
 * « Le contrôle direct des objets connectés ne doit PAS être disponible
 * depuis le Web. Le Web sert à la supervision. » Il n'y a donc ici
 * aucun bouton d'allumage, aucune bascule d'automatisation, aucune
 * activation de programme — et ce n'est pas une fonctionnalité qui
 * manque. La commande vit sur le téléphone, à côté de la machine, où
 * l'on voit ce qu'on déclenche. L'écran l'énonce une fois, clairement,
 * plutôt que de laisser chacun chercher le bouton.
 *
 * ══════════════════════════════════════════════════════════════════
 * TOUT ÉTAT AFFICHÉ PORTE SA DATE
 * ══════════════════════════════════════════════════════════════════
 *
 * Il n'y a pas de temps réel : la publication `supabase_realtime` ne
 * contient aucune table, pour tout le produit. Rien de ce que le
 * téléphone écrit n'arrive ici sans que la page soit redemandée.
 *
 * Et la date elle-même est modeste : `etat_connu_le` est la dernière
 * ÉCRITURE de la ligne, pas le dernier RELEVÉ. Renommer un bioréacteur
 * la rafraîchit sans qu'aucune mesure n'ait été prise. C'est la
 * meilleure approximation disponible et l'écran l'affiche comme telle —
 * « connu il y a 3 h », jamais « en marche » tout court.
 *
 * AUCUN CHIFFRE N'EST CALCULÉ ICI : tout vient de
 * `biolab_supervision_equipements`, la lecture posée au §5 de la
 * migration 0087, qui est `security invoker` — la RLS s'applique à
 * l'intérieur.
 */
export default async function EquipementsBioLabPage() {
  const perimetre = await perimetreBioLab();
  // Un seul garde pour les deux refus possibles : le droit manquant
  // et le module que l'entreprise a éteint (§43). Voir lib/biolab/etats.tsx.
  const refus = refusBioLab(perimetre, "La supervision des équipements");

  if (refus) {
    return (
      <div className="mx-auto max-w-5xl px-8 py-10">
        <PageHeader title="Équipements" subtitle="Les bioréacteurs du laboratoire." />
        {refus}
      </div>
    );
  }

  const maintenant = new Date();
  const supervision = await lireSupervision(perimetre.workspaceId);

  if (supervision.erreur) {
    // LA LECTURE A ÉCHOUÉ — ce n'est pas « aucun bioréacteur ».
    // Cas concret d'aujourd'hui : la migration 0087, qui pose
    // `biolab_supervision_equipements`, n'est pas encore appliquée.
    // Annoncer un laboratoire vide serait une affirmation fausse sur le
    // matériel de quelqu'un.
    return (
      <div className="mx-auto max-w-5xl px-8 py-10">
        <PageHeader title="Équipements" subtitle="Les bioréacteurs du laboratoire." />
        <LectureImpossible sujet="La supervision des équipements" erreur={supervision.erreur} />
      </div>
    );
  }

  const equipements = supervision.lignes;

  // Un appareil en défaut ou en avertissement se lit avant les autres :
  // c'est la seule raison d'ouvrir cette page en urgence.
  const enDefaut = equipements.filter(
    (ligne) => ligne.statut === "fault" || ligne.statut === "warning",
  );

  return (
    <div className="mx-auto max-w-6xl px-8 py-10">
      <PageHeader
        title="Équipements"
        subtitle={
          equipements.length > 0
            ? `${equipements.length} bioréacteur${equipements.length > 1 ? "s" : ""} dans le laboratoire de ${perimetre.organisation.name}.`
            : "Les bioréacteurs du laboratoire, leur état et leurs cycles."
        }
        action={
          <ButtonLink href="/biolab/lieux" variant="secondary">
            Voir les lieux
          </ButtonLink>
        }
      />

      {/* ---------------------------------------------------------------
          LA LIMITE DU §7, ÉNONCÉE UNE FOIS, SANS S'EXCUSER.
          Ce n'est pas un avertissement d'erreur : c'est la règle de
          fonctionnement du produit, et un chef de culture doit la
          connaître avant de chercher un bouton qui n'existera jamais.
         --------------------------------------------------------------- */}
      <Card className="mb-5 flex items-start gap-3 px-5 py-4">
        <Icon name="equipment" className="mt-0.5 h-5 w-5 shrink-0 text-ink-soft" />
        <p className="text-[var(--text-body)] text-ink-soft">
          <strong className="text-ink">Le web supervise, le téléphone commande.</strong> Vous
          voyez ici l&apos;état des appareils, leur programme et leurs cycles. Démarrer une
          immersion, activer l&apos;automatisation ou changer un programme se fait depuis
          l&apos;application mobile, à côté de la machine — c&apos;est un choix
          d&apos;architecture, pour qu&apos;on ne déclenche jamais une pompe sans la voir.
        </p>
      </Card>

      {equipements.length === 0 ? (
        <EspaceVide
          quoi="Aucun bioréacteur dans l'espace de cette entreprise"
          aQuoiCaSert="Cette page montrera l'état de chaque appareil, le lot qu'il porte, son programme actif et ses derniers cycles."
        />
      ) : (
        <>
          {enDefaut.length > 0 && (
            <Panel
              title="À regarder en premier"
              description="Les appareils qui se signalent eux-mêmes."
              className="mb-5"
            >
              <ul className="divide-y divide-line">
                {enDefaut.map((ligne) => {
                  const fraicheur = fraicheurEtat(ligne.etat_connu_le, maintenant);
                  return (
                    <li key={ligne.bioreacteur_id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                      <StatusBadge tone={tonDe(STATUT_BIOREACTEUR_TON, ligne.statut)}>
                        {libelle(STATUT_BIOREACTEUR_LABELS, ligne.statut)}
                      </StatusBadge>
                      <span className="font-medium">{ligne.code ?? ligne.nom ?? "Sans code"}</span>
                      <span className="text-[var(--text-secondary)] text-ink-faint">
                        {fraicheur.texte}
                      </span>
                      <Link
                        href={`/biolab/equipements/${ligne.bioreacteur_id}`}
                        className="ml-auto text-[var(--text-secondary)] font-medium text-accent hover:underline"
                      >
                        Ouvrir la fiche →
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </Panel>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            {equipements.map((ligne) => {
              const fraicheur = fraicheurEtat(ligne.etat_connu_le, maintenant);
              const objets = direObjets(ligne);

              return (
                <Card key={ligne.bioreacteur_id} className="p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link
                        href={`/biolab/equipements/${ligne.bioreacteur_id}`}
                        className="text-[length:var(--text-card)] font-semibold hover:underline"
                      >
                        {ligne.code ?? "Sans code"}
                      </Link>
                      <p className="mt-0.5 text-[var(--text-secondary)] text-ink-soft">
                        {ligne.nom ?? "Sans nom"}
                        {ligne.type_bioreacteur
                          ? ` · ${libelle(TYPE_BIOREACTEUR_LABELS, ligne.type_bioreacteur)}`
                          : ""}
                      </p>
                    </div>
                    <StatusBadge tone={tonDe(STATUT_BIOREACTEUR_TON, ligne.statut)}>
                      {libelle(STATUT_BIOREACTEUR_LABELS, ligne.statut)}
                    </StatusBadge>
                  </div>

                  {/* LA DATE, COLLÉE À L'ÉTAT. Une valeur d'état sans
                      date de relevé est une affirmation invérifiable. */}
                  <p className="mt-2 text-[var(--text-secondary)] text-ink-faint">
                    État {fraicheur.texte}
                    {fraicheur.ancien && (
                      <>
                        {" — "}
                        <span className="text-warning">
                          aucune écriture depuis : c&apos;est le dernier état connu, pas une mesure
                          d&apos;aujourd&apos;hui
                        </span>
                      </>
                    )}
                  </p>

                  <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-line pt-4">
                    <div>
                      <dt className="eyebrow">Automatisation</dt>
                      <dd className="mt-1 text-[var(--text-body)]">
                        {ligne.automatisation_active === null ? (
                          <span className="text-ink-faint">Non renseignée</span>
                        ) : ligne.automatisation_active ? (
                          <Badge tone="positive">Active</Badge>
                        ) : (
                          <Badge tone="neutral">Désactivée</Badge>
                        )}
                      </dd>
                    </div>

                    <div>
                      <dt className="eyebrow">Lot en cours</dt>
                      <dd className="mt-1 text-[var(--text-body)]">
                        {ligne.lot_en_cours_id ? (
                          <Link
                            href={`/biolab/lots/${ligne.lot_en_cours_id}`}
                            className="font-medium text-accent hover:underline"
                          >
                            {ligne.lot_en_cours_code ?? "Voir le lot"}
                          </Link>
                        ) : (
                          <span className="text-ink-faint">Aucun</span>
                        )}
                      </dd>
                    </div>

                    <div>
                      <dt className="eyebrow">Programme actif</dt>
                      <dd className="mt-1 text-[var(--text-body)]">
                        {ligne.programme_actif_libelle ?? (
                          <span className="text-ink-faint">Aucun</span>
                        )}
                      </dd>
                    </div>

                    <div>
                      <dt className="eyebrow">Dernier cycle</dt>
                      <dd className="mt-1 text-[var(--text-body)]">
                        {ligne.dernier_cycle_statut ? (
                          <span className="inline-flex flex-wrap items-center gap-1.5">
                            <Badge tone={tonDe(STATUT_CYCLE_TON, ligne.dernier_cycle_statut)}>
                              {libelle(STATUT_CYCLE_LABELS, ligne.dernier_cycle_statut)}
                            </Badge>
                            <span className="text-ink-soft">
                              {libelle(CYCLE_LABELS, ligne.dernier_cycle_type)}
                            </span>
                          </span>
                        ) : (
                          /* Zéro cycle enregistré n'est pas « zéro cycle
                             exécuté » : c'est une machine dont personne
                             n'a encore écrit l'histoire. */
                          <span className="text-ink-faint">Aucun cycle enregistré</span>
                        )}
                      </dd>
                    </div>
                  </dl>

                  <p className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3 text-[var(--text-secondary)]">
                    <StatusBadge tone={objets.ton} dot={objets.ton !== "neutral"}>
                      {objets.texte}
                    </StatusBadge>
                    {/* C'EST LE PLUS ANCIEN CONTACT QUI QUALIFIE UN
                        GROUPE, pas le plus récent. Et l'absence de date
                        se dit : ne rien afficher laissait croire que la
                        question ne se posait pas. */}
                    {ligne.plus_ancienne_presence_objet ? (
                      <span className="text-ink-faint">
                        le plus ancien contact remonte à{" "}
                        {formatDateHeure(ligne.plus_ancienne_presence_objet)}
                      </span>
                    ) : (ligne.objets_lies ?? 0) > 0 ? (
                      <span className="text-ink-faint">date de dernier contact inconnue</span>
                    ) : null}
                  </p>
                </Card>
              );
            })}
          </div>
        </>
      )}

      {/* §9 — LA FRAÎCHEUR DE LA PAGE ELLE-MÊME, dite plutôt que promise. */}
      <p className="mt-6 text-[var(--text-secondary)] text-ink-faint">
        Page lue à {formatHeure(maintenant)}. Elle ne reçoit rien en direct : rechargez-la pour
        voir ce que le téléphone a écrit depuis.
      </p>
    </div>
  );
}
