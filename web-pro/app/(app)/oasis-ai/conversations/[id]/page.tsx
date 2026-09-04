import { notFound } from "next/navigation";
import { Badge, Card, ConfirmDialog, SubmitButton } from "@/components/ui";
import { requireOrganization } from "@/lib/auth/organization";
import { formatCents } from "@/lib/quotes/types";
import { lireFil, type EtatApprobation } from "@/lib/ai/conversations/lecture";
import { repondreApprobationDuFil, supprimerFil } from "@/lib/ai/conversations/actions";
import { lireProposition } from "@/lib/ai/conversations/proposition";
import {
  MESSAGES_PAR_FIL_MAX,
  indexDeCoupe,
  titreDuFil,
  type ActionPreparee,
  type CoucheAffichee,
} from "@/lib/ai/conversations/types";
import { donneesConsultees } from "@/lib/ai/etiquettes";
import { PROPOSALS } from "@/lib/ai/proposals";
import { CONFIDENCE_LABELS, CONFIDENCE_TONES, isConfidence } from "@/lib/ai/types";
import { Composeur } from "../Composeur";
import { PropositionDuFil } from "../Proposition";

/**
 * §11W — UN FIL, ET LA SEULE CHOSE QU'IL DOIT PROUVER.
 *
 * ══════════════════════════════════════════════════════════════════
 * L'ÉCRAN NE PEUT PAS MENTIR SUR CE QUE LE MODÈLE RELIT
 * ══════════════════════════════════════════════════════════════════
 *
 * C'est toute la raison d'être de cette page. L'ancien assistant
 * refusait d'afficher un fil, et il avait raison POUR SON ÉPOQUE :
 * chaque question repartait de zéro, donc une conversation continue à
 * l'écran aurait laissé croire à une mémoire inexistante.
 *
 * Ici, la mémoire existe : `poserQuestion` transmet réellement les
 * tours précédents au modèle, dans la forme native du SDK. Mais elle
 * est BORNÉE — seize messages et six mille caractères, la borne la plus
 * stricte gagnant — et un fil silencieusement rogné serait exactement
 * le même mensonge, en plus sournois.
 *
 * D'où le filet horizontal, posé à l'endroit EXACT de la coupe, à
 * l'intérieur du fil. L'oubli se voit là où il devient vrai, au moment
 * où il devient vrai, plutôt qu'en petit sous le champ de saisie.
 *
 * Et sa position ne se devine pas : `ai_conversation_tail` (0079) rend
 * la queue ET le drapeau `tronque` dans le même parcours. L'écran ne
 * calcule pas sa propre idée de la coupe, il demande à la base celle
 * qu'elle appliquera à la question suivante. Les deux ne PEUVENT pas
 * diverger.
 */
export default async function FilPage({ params }: PageProps<"/oasis-ai/conversations/[id]">) {
  const organization = await requireOrganization();
  const { id } = await params;

  const fil = await lireFil(organization.organizationId, id);

  // `null` = le fil n'existe pas, OU n'est pas le vôtre. Les deux se
  // disent pareil, exprès : apprendre l'existence du fil d'un collègue
  // serait déjà en apprendre trop.
  if (fil === null) notFound();

  const coupe = indexDeCoupe(fil.messages.length, fil.queue);
  // La même réserve que la Server Action : un tour écrit jusqu'à sept
  // lignes, et le champ doit se fermer avant que le lot ne franchisse
  // le mur en cours d'insertion.
  const plein = fil.messages.length + 7 > MESSAGES_PAR_FIL_MAX;

  // Le droit d'écrire dans `ai_actions` et de répondre à une validation
  // (0072, section 14). Le même que sur l'accueil, pour que le même
  // bouton n'apparaisse pas ici et pas là.
  const canAct = organization.permissions.includes("projects.manage");

  return (
    <div className="flex min-h-[24rem] flex-col">
      {/* ---- L'en-tête du fil : tout le modèle de mémoire, en une ligne ---- */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3 border-b border-line pb-4">
        <div className="min-w-0">
          <h2 className="text-[length:var(--text-section)] font-semibold tracking-tight">
            {titreDuFil(fil.fil)}
          </h2>
          <p className="mt-1 text-[var(--text-secondary)] text-ink-soft">
            Conversation ouverte{" "}
            {new Date(fil.fil.ouvertLe).toLocaleString("fr-FR", {
              weekday: "long",
              day: "numeric",
              month: "long",
              hour: "2-digit",
              minute: "2-digit",
            })}{" "}
            {fil.queue.illisible
              ? "— la mémoire de ce fil n'a pas pu être relue."
              : "— Oasis relit cette conversation, et rien d'autre."}
          </p>
        </div>

        {/* TOUJOURS PAR LA FONCTION, JAMAIS PAR UN `DELETE` DIRECT.
            PostgreSQL exige qu'une ligne visée par un `delete` soit
            aussi visible par les politiques de `select` : une politique
            de suppression ne peut donc jamais être plus permissive que
            la lecture. Un `delete` direct marcherait pour un membre en
            règle et échouerait EN SILENCE pour qui a perdu
            `projects.read` — l'écran dirait « supprimé » sur une ligne
            toujours en base, pleine de noms de clients.
            `ai_conversation_supprimer` est `security definer` et ne
            teste que `user_id = auth.uid()`. */}
        <ConfirmDialog
          triggerLabel="Supprimer"
          triggerVariant="ghost"
          title="Supprimer cette conversation ?"
          message="Elle et tous ses messages disparaissent de la base — définitivement, sans corbeille ni archive. Ce qu'Oasis a préparé ou exécuté depuis cette conversation reste, lui, dans le journal."
          confirmLabel="Supprimer définitivement"
          confirmVariant="danger"
          action={supprimerFil}
          hidden={{ conversationId: fil.fil.id }}
        />
      </div>

      {fil.failed && (
        <Card className="mb-6 border-warning/30 bg-warning-wash px-4 py-3.5">
          <p className="text-[var(--text-body)] font-medium text-warning">
            Les messages de cette conversation n&apos;ont pas pu être lus.
          </p>
          <p className="mt-1 text-[var(--text-secondary)] text-warning">
            Ce n&apos;est pas « elle est vide ». Le champ reste fermé : Oasis repartirait
            de zéro sans le savoir.
          </p>
        </Card>
      )}

      {/* LA MÉMOIRE ILLISIBLE SE DIT, ET LE CHAMP SE FERME.
          Sans cet encart, le fil s'affichait entier, sans filet de
          coupe, sous une phrase promettant qu'Oasis le relit — puis la
          question suivante partait avec un historique vide. C'est la
          divergence écran/modèle que ce module existe pour empêcher,
          obtenue par une panne plutôt que par un oubli. La Server
          Action refuse elle aussi : les deux portes disent la même
          chose. */}
      {!fil.failed && fil.queue.illisible && (
        <Card className="mb-6 border-warning/30 bg-warning-wash px-4 py-3.5">
          <p className="text-[var(--text-body)] font-medium text-warning">
            La mémoire de cette conversation n&apos;a pas pu être relue.
          </p>
          <p className="mt-1 text-[var(--text-secondary)] text-warning">
            Ce n&apos;est pas « elle est vide » : les messages ci-dessous sont bien là, mais
            Oasis ne pourrait pas les relire pour répondre. Le champ reste fermé le temps
            que ça revienne — répondre sans mémoire en laissant croire le contraire serait
            pire que ne pas répondre.
          </p>
        </Card>
      )}

      {/* ---- Les tours ---- */}
      <ol className="flex-1 space-y-5">
        {fil.messages.map((message, position) => (
          <li key={message.id}>
            {position === coupe && <FiletDeCoupe omis={fil.queue.omis} />}

            {message.role === "user" ? (
              <div className="flex justify-end">
                <p className="max-w-[42rem] whitespace-pre-line rounded-[var(--radius-card)] bg-accent-wash px-4 py-2.5 text-[var(--text-body)]">
                  {message.contenu}
                </p>
              </div>
            ) : (
              <div className="max-w-[46rem]">
                {/* LA RÉPONSE ENTIÈRE, ET PAS SEULEMENT SON RÉSUMÉ.
                    `contenu` a été composé hors modèle à partir des
                    champs typés : le résumé, une ligne par
                    recommandation avec son impact en centimes et son
                    action, puis ce qui manquait pour conclure. C'est
                    aussi, mot pour mot, ce que le modèle relira. */}
                <p className="whitespace-pre-line text-[var(--text-body)] leading-relaxed">
                  {message.contenu}
                </p>

                <QualiteDeLaReponse couche={message.couche} />

                <Raisons couche={message.couche} />

                <AvertissementsDuRuntime avertissements={message.couche.avertissements} />

                {message.couche.actions.map((action) => (
                  <ActionDuFil
                    key={action.actionId}
                    action={action}
                    conversationId={fil.fil.id}
                    etat={fil.approbations.get(action.actionId) ?? null}
                    canAct={canAct}
                  />
                ))}

                <SourcesLues outils={message.outils} />

                {(() => {
                  // La proposition est relue ici, et son `kind` confronté
                  // à la liste FIGÉE du code : la colonne est un `jsonb`
                  // sans contrainte d'énumération — le bon choix en base,
                  // parce qu'une liste recopiée en SQL divergerait au
                  // premier ajout — donc la vérification appartient au
                  // côté où la liste est vraie.
                  const proposition = lireProposition(message.proposition);
                  if (proposition === null) return null;
                  return (
                    <PropositionDuFil
                      messageId={message.id}
                      conversationId={fil.fil.id}
                      proposition={proposition}
                      statut={message.statutProposition}
                      autorise={organization.permissions.includes(
                        PROPOSALS[proposition.kind].permission,
                      )}
                    />
                  );
                })()}
              </div>
            )}
          </li>
        ))}
      </ol>

      {/* ---- Le champ, en bas du fil ---- */}
      <div className="mt-8">
        <Composeur
          variante="fil"
          conversationId={fil.fil.id}
          ferme={
            plein
              ? {
                  raison:
                    `Cette conversation approche de ses ${MESSAGES_PAR_FIL_MAX} messages et n'a ` +
                    "plus la place d'un échange complet. Ouvrez-en une nouvelle : elle repartira " +
                    "de zéro, comme toujours.",
                }
              : fil.queue.illisible
                ? {
                    raison:
                      "La mémoire de cette conversation n'a pas pu être relue : Oasis répondrait " +
                      "sans les tours ci-dessus. Réessayez dans un instant, ou ouvrez une " +
                      "nouvelle conversation.",
                  }
                : undefined
          }
        />
      </div>
    </div>
  );
}

/**
 * LE FILET. C'est le signal central de tout cet écran.
 *
 * Il traverse le fil à l'endroit exact où la mémoire s'arrête. Pas une
 * couleur, pas une icône : un trait et une phrase, parce que
 * l'information doit se lire au lecteur d'écran comme à l'œil.
 *
 * `<hr>` porte le sens dans l'arbre d'accessibilité ; le texte n'est
 * pas décoratif et n'est donc pas caché.
 */
function FiletDeCoupe({ omis }: { omis: number }) {
  return (
    <div className="mb-5 flex items-center gap-3">
      <hr className="min-w-6 flex-1 border-t border-dashed border-line-strong" />
      <span className="shrink-0 text-[11px] text-ink-faint">
        Oasis ne relit plus au-delà de cette ligne
        {omis > 0 && ` — ${omis} message${omis > 1 ? "s" : ""} plus ancien${omis > 1 ? "s" : ""}`}
      </span>
      <hr className="min-w-6 flex-1 border-t border-dashed border-line-strong" />
    </div>
  );
}

/**
 * LA CONFIANCE, ET L'ABSENCE — DEUX FORMES, JAMAIS DEUX COULEURS.
 *
 * La règle est celle de l'accueil, à trois mètres de là, et elle est
 * appliquée ici pour la même raison : « élevée » est le défaut, et
 * l'écrire sous chaque réponse apprend à ne plus lire le badge, donc à
 * rater « faible » le jour où il compte.
 *
 * « Données insuffisantes » n'est PAS une confiance basse — le socle le
 * dit en toutes lettres au modèle — et ne s'affiche donc pas ici : elle
 * est déjà écrite dans le texte de la réponse, en toutes lettres, avec
 * ce qui manque. Une pastille de plus ferait deux formes pour une seule
 * information.
 */
function QualiteDeLaReponse({ couche }: { couche: CoucheAffichee }) {
  const confiance = isConfidence(couche.confiance) ? couche.confiance : null;
  const badgeConfiance =
    confiance !== null && confiance !== "high" && confiance !== "insufficient_data";

  if (!badgeConfiance && !couche.ambigu) return null;

  return (
    <div className="mt-2.5 flex flex-wrap gap-1.5">
      {badgeConfiance && confiance !== null && (
        <Badge tone={CONFIDENCE_TONES[confiance]}>
          {CONFIDENCE_LABELS[confiance]}
        </Badge>
      )}
      {/* `ambigu` est DÉCLARÉ par l'agent, jamais deviné : c'est le
          second déclencheur d'escalade de la spec, et il veut dire
          « deux lectures des mêmes chiffres se défendent » — pas
          « il manque une donnée ». */}
      {couche.ambigu && <Badge tone="warning">Deux lectures possibles</Badge>}
    </div>
  );
}

/**
 * LE « POURQUOI ? », REPLIÉ — comme partout ailleurs dans ce produit.
 *
 * Ce qui est visible sans clic (le titre, le montant, l'action) vit
 * dans le texte de la réponse, donc dans ce que le modèle relira. Ce qui
 * est ici est la justification : elle se déplie, et le modèle sait la
 * recalculer. `<details>` natif, donc pas d'état, pas de composant
 * client, et le clavier marche sans qu'on écrive une ligne.
 */
function Raisons({ couche }: { couche: CoucheAffichee }) {
  if (couche.raisons.length === 0) return null;

  return (
    <details className="group mt-3">
      <summary className="cursor-pointer list-none text-[var(--text-secondary)] text-accent">
        <span className="group-open:hidden">Pourquoi ?</span>
        <span className="hidden text-ink-faint group-open:inline">Replier</span>
      </summary>
      <div className="mt-2 space-y-3 rounded-[var(--radius-control)] bg-surface-sunken px-4 py-3.5">
        {couche.raisons.map((entree, position) => (
          <div key={position}>
            <p className="text-[var(--text-body)] font-medium">{entree.titre}</p>
            {entree.pourquoi && (
              <p className="mt-0.5 text-[var(--text-secondary)] text-ink-soft">
                {entree.pourquoi}
              </p>
            )}
            {entree.raisons.length > 0 && (
              <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-[var(--text-secondary)] text-ink-soft">
                {entree.raisons.map((raison, index) => (
                  <li key={index}>{raison}</li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </details>
  );
}

/**
 * CE QUE LE RUNTIME A SIGNALÉ EN CHEMIN.
 *
 * Ils étaient jetés en silence, et le plus grave d'entre eux annonce
 * qu'un MONTANT a été retiré de la réponse parce qu'il ne figurait dans
 * aucune donnée lue — sans lui, l'utilisateur voit une recommandation
 * sans chiffre et croit qu'Oasis n'a pas su estimer. On y trouve aussi
 * « Analyse partielle : le droit X manque à ce compte », le repli sur un
 * modèle dégradé, et les alertes de plafond : trois choses qui changent
 * la valeur de la réponse.
 *
 * En gris et sous la réponse, jamais au-dessus : ils qualifient la
 * réponse, ils ne la remplacent pas.
 */
function AvertissementsDuRuntime({ avertissements }: { avertissements: string[] }) {
  if (avertissements.length === 0) return null;

  return (
    <div className="mt-3 rounded-[var(--radius-control)] border border-warning/30 bg-warning-wash px-3.5 py-2.5">
      <ul className="space-y-1">
        {avertissements.map((avertissement, index) => (
          <li key={index} className="text-[var(--text-secondary)] text-warning">
            {avertissement}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * UNE ACTION PRÉPARÉE, AVEC SON BOUTON, DANS LE FIL QUI L'A PRODUITE.
 *
 * ─── LE DÉFAUT QUE CE COMPOSANT FERME ───
 *
 * Le moteur d'actions enregistre `ai_actions` + `ai_action_approvals`
 * avec une expiration à vingt-quatre heures, et le modèle est instruit
 * de conclure par « confirmez ». Le fil, lui, n'affichait ni l'action,
 * ni son montant, ni son échéance, ni le moindre lien : le seul bouton
 * vivait sur l'autre onglet, sous « Demandes venues d'une conversation »,
 * et rien ne l'annonçait ici. Une expiration qui court sur un écran que
 * l'utilisateur ne sait pas devoir ouvrir n'est pas une confirmation.
 *
 * ─── LA PHOTO ET L'ÉTAT SONT DEUX CHOSES ───
 *
 * Le libellé, le résumé et le montant viennent du message : c'est de
 * l'histoire, composée hors modèle, et elle ne bouge plus. Le STATUT
 * vient de `ai_action_approvals`, relu à chaque affichage, parce qu'un
 * clic ou une expiration l'a peut-être changé depuis. Sans état lisible,
 * on ne devine pas : on le dit.
 */
function ActionDuFil({
  action,
  conversationId,
  etat,
  canAct,
}: {
  action: ActionPreparee;
  conversationId: string;
  etat: EtatApprobation | null;
  canAct: boolean;
}) {
  const approvalId = etat?.approvalId ?? action.approvalId;
  const enAttente = etat?.statut === "pending";

  return (
    <Card className="mt-3">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
        <Badge tone={enAttente ? "accent" : "neutral"}>
          {enAttente ? "À valider" : etatLisible(etat)}
        </Badge>
        <h4 className="min-w-0 flex-1 text-[length:var(--text-card)] font-medium leading-tight">
          {action.libelle}
        </h4>
        {/* Un tiret, jamais « 0 € » : « montant inconnu » et « gratuit »
            ne se lisent pas pareil, et ce dépôt a corrigé trois fois le
            motif inverse. */}
        <span
          className={`tabular shrink-0 text-[var(--text-body)] font-medium ${
            action.montantCents === null ? "text-ink-faint" : ""
          }`}
        >
          {formatCents(action.montantCents)}
        </span>
      </div>

      <div className="px-4 py-3">
        <p className="text-[var(--text-secondary)] text-ink-soft">{action.resume}</p>
        {enAttente && etat?.expireLe && (
          <p className="mt-1 text-[11px] text-ink-faint">
            À confirmer avant le{" "}
            {new Date(etat.expireLe).toLocaleString("fr-FR", {
              day: "numeric",
              month: "long",
              hour: "2-digit",
              minute: "2-digit",
            })}
            . Passé ce délai, la demande expire sans rien exécuter.
          </p>
        )}
      </div>

      {enAttente && approvalId !== null && (
        <div className="border-t border-line px-4 py-3">
          {canAct ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-[var(--text-secondary)] text-ink-faint">
                Rien n&apos;est écrit tant que vous n&apos;avez pas cliqué.
              </p>
              <div className="flex flex-wrap gap-2">
                {/* Le formulaire ne porte QUE l'identifiant de
                    l'approbation : `answerApproval` relit l'action et
                    son type sur la ligne, filtrée sur l'organisation de
                    la session, et n'exécute que ce que cette ligne
                    désigne. */}
                <form action={repondreApprobationDuFil}>
                  <input type="hidden" name="approvalId" value={approvalId} />
                  <input type="hidden" name="conversationId" value={conversationId} />
                  <input type="hidden" name="ok" value="1" />
                  <SubmitButton>Valider et exécuter</SubmitButton>
                </form>
                <form action={repondreApprobationDuFil}>
                  <input type="hidden" name="approvalId" value={approvalId} />
                  <input type="hidden" name="conversationId" value={conversationId} />
                  <input type="hidden" name="ok" value="0" />
                  <SubmitButton variant="ghost">Refuser</SubmitButton>
                </form>
              </div>
            </div>
          ) : (
            <p className="text-[var(--text-secondary)] text-ink-faint">
              Votre rôle ne permet pas de répondre à une validation. Transmettez-la à un
              administrateur.
            </p>
          )}
        </div>
      )}
    </Card>
  );
}

/** L'état d'une demande, dit en français — ou avoué inconnu. */
function etatLisible(etat: EtatApprobation | null): string {
  if (etat === null) return "État inconnu";
  switch (etat.statut) {
    case "approved":
      return "Validée";
    case "rejected":
      return "Refusée";
    case "expired":
      return "Expirée";
    default:
      return etat.statut;
  }
}

/**
 * « Données consultées », et le défaut visible qu'elle ferme.
 *
 * L'ancien écran rendait ce bloc dès que la liste brute n'était pas
 * vide, puis filtrait sur une table de onze étiquettes écrite à la
 * main alors que le modèle dispose d'une vingtaine d'outils. Une
 * réponse obtenue par le seul `getCompanyMetrics` affichait
 * littéralement « Données consultées : . »
 *
 * Deux règles, désormais : on compte ce qui va S'AFFICHER, pas ce qui a
 * été appelé ; et `null` (on ne sait pas) se distingue de `[]` (le
 * modèle n'a rien lu). Dans le premier cas l'écran se tait ; dans le
 * second il peut le dire, et c'est utile — une réponse sans source est
 * une réponse à relire.
 */
function SourcesLues({ outils }: { outils: string[] | null }) {
  if (outils === null) return null;

  const libelles = donneesConsultees(outils);

  if (libelles.length === 0) {
    return (
      <p className="mt-3 border-t border-line pt-2.5 text-[var(--text-secondary)] text-ink-faint">
        Aucune donnée consultée pour cette réponse.
      </p>
    );
  }

  return (
    <p className="mt-3 border-t border-line pt-2.5 text-[var(--text-secondary)] text-ink-faint">
      Données consultées : {libelles.join(", ")}.
    </p>
  );
}

export const dynamic = "force-dynamic";
