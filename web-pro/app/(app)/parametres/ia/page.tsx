import Link from "next/link";
import { requireOrganization } from "@/lib/auth/organization";
import { Card, PageHeader, Panel, Badge, StatusBadge, MetricCard, EmptyState } from "@/components/ui";
import { Icon } from "@/components/shell/Icon";
import {
  libellePanneClient,
  nomAgentDuJournal,
  type LigneVentilation,
  type Volume,
} from "@/lib/ai/admin";
import {
  lireConsommation,
  lireNomsUtilisateurs,
  lireStatistiquesAvis,
  lireTitresDecisions,
  type EtatLecture,
} from "@/lib/ai/admin/lecture";
import { lireQuotaAssistant, type QuotaAssistant } from "@/lib/ai/admin/quota";

/**
 * §11X — « CONSOMMATION D'OASIS AI », CE QUI RESTE AU CLIENT.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE QUI ÉTAIT ICI, ET POURQUOI CE N'EST PLUS ICI
 * ══════════════════════════════════════════════════════════════════
 *
 * Cette adresse portait « AI Configuration » (spec p. 26) : la carte
 * agent → modèle avec son sélecteur, le contrôle de disponibilité des
 * trois identifiants, et sous `/parametres/ia/couts` le tableau des
 * coûts en euros, la grille tarifaire, le ratio 15/80/5 et les trois
 * plafonds de dépense.
 *
 * Le client n'aurait jamais dû tenir ces manettes. Le choix du modèle
 * décide du prix par jeton, et la facture du fournisseur arrive chez
 * l'ÉDITEUR ; le plafond censé borner cette dépense était réglable par
 * la partie plafonnée, qui pouvait le relever, le vider ou le
 * supprimer. La migration 0080 a fermé le chemin en base — plus aucune
 * politique d'écriture sur `ai_model_overrides` ni `ai_cost_limits` —
 * et les écrans sont partis avec, dans le Control Center. Les laisser
 * ici aurait produit des boutons qui échouent sur un refus Postgres :
 * pire qu'une absence, parce qu'ils promettent encore.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE QUE LE CLIENT GARDE, ET C'EST DÉLIBÉRÉ
 * ══════════════════════════════════════════════════════════════════
 *
 * Il ne décide pas ce que son IA coûte à l'éditeur. Il a en revanche le
 * droit de savoir CE QU'IL CONSOMME : combien de questions sur son
 * forfait, combien d'appels, par quel agent, pour quelle décision, par
 * qui, et pourquoi son assistant s'est arrêté un après-midi. Sans cette
 * page, un arrêt pour limite atteinte ressemble à une panne, et
 * l'entreprise appelle le support pour un fonctionnement normal.
 *
 * La règle de partage tient en une phrase, écrite ici parce que c'est
 * ici qu'on est tenté de l'enfreindre : DES QUESTIONS, DES APPELS ET
 * DES JETONS — JAMAIS UN EURO, JAMAIS UN NOM DE MODÈLE. Le montant que
 * le grand livre porte est le prix d'achat de l'éditeur chez son
 * fournisseur, pas le prix payé par le client ; l'afficher livrerait
 * une marge et ferait passer une estimation pour une facture. Ce que
 * l'entreprise paie, elle le lit sur son abonnement.
 *
 * ══════════════════════════════════════════════════════════════════
 * POURQUOI CETTE PAGE N'EST PLUS RÉSERVÉE AUX ADMINISTRATEURS
 * ══════════════════════════════════════════════════════════════════
 *
 * L'ancienne version refusait l'entrée à tout non-administrateur, et
 * elle avait raison : elle AFFICHAIT les identifiants de modèle, ce que
 * la page 27 interdit de montrer à un utilisateur métier. Ce motif a
 * disparu avec les identifiants.
 *
 * Reste la doctrine ordinaire de §42 : on n'escamote pas un écran, on
 * retire de quoi écrire et on dit pourquoi. Ici il n'y a plus rien à
 * écrire du tout — la page est en lecture seule de bout en bout.
 *
 * UNE SEULE EXCEPTION, ET ELLE EST NOMINATIVE : la ventilation « par
 * personne » dit qui, dans l'entreprise, sollicite Oasis et combien.
 * C'est une information de gestion, pas une information d'équipe. Elle
 * reste derrière `organization.manageUsers`, exactement le périmètre
 * qui la voyait hier. Le reste s'ouvre ; rien ne s'ouvre de plus qu'hier
 * sur les personnes.
 */
export default async function ConsommationIAPage() {
  const organization = await requireOrganization();
  const peutVoirLesPersonnes = organization.permissions.includes("organization.manageUsers");

  const organizationId = organization.organizationId;
  const maintenant = new Date();

  const [quota, consommation, avis] = await Promise.all([
    lireQuotaAssistant(organizationId, maintenant),
    lireConsommation(organizationId, maintenant),
    lireStatistiquesAvis(organizationId),
  ]);

  const tableau = consommation.donnees;

  // Les noms se lisent APRÈS l'agrégation, et seulement pour les lignes
  // qu'on affiche : une jointure sur tout le grand livre coûterait cher
  // pour des lignes qui ne tiendront pas à l'écran. Et pas du tout
  // quand la ventilation nominative n'est pas rendue.
  const [titres, noms] = await Promise.all([
    lireTitresDecisions(organizationId, tableau.parDecision.slice(0, 8).map((l) => l.cle)),
    peutVoirLesPersonnes
      ? lireNomsUtilisateurs(organizationId, tableau.parUtilisateur.slice(0, 8).map((l) => l.cle))
      : Promise.resolve(new Map<string, string>()),
  ]);

  const grandLivreVide = consommation.etat === "lue" && tableau.mois.appels === 0;
  const lue = consommation.etat === "lue";

  return (
    <div className="mx-auto max-w-5xl px-8 py-10">
      <PageHeader
        eyebrow="Oasis AI"
        title="Consommation d'Oasis AI"
        subtitle="Ce que vos équipes demandent à Oasis ce mois-ci, et où vous en êtes de votre forfait."
      />

      {/* ---- LE FORFAIT, EN PREMIER ----
          C'est la seule chose de cette page qui peut arrêter le
          travail de quelqu'un demain matin. Elle passe donc avant les
          compteurs, et elle s'affiche même quand le grand livre est
          illisible : les deux ne viennent pas de la même table. */}
      <QuotaCard etat={quota.etat} message={quota.message} quota={quota.donnees} />

      {/* ---- La lecture du grand livre n'a pas abouti ---- */}
      {consommation.etat !== "lue" && (
        <Card
          className={`mb-6 px-5 py-4 ${
            consommation.etat === "absente"
              ? "border-info/30 bg-info-wash"
              : "border-warning/30 bg-warning-wash"
          }`}
        >
          <p
            className={`text-[var(--text-body)] font-medium ${
              consommation.etat === "absente" ? "text-info" : "text-warning"
            }`}
          >
            {consommation.message}
          </p>
          <p
            className={`mt-1 text-[var(--text-secondary)] ${
              consommation.etat === "absente" ? "text-info" : "text-warning"
            }`}
          >
            Les compteurs ci-dessous ne sont donc pas « zéro » : ils sont INCONNUS. Votre forfait
            de questions, lui, se lit dans une autre table et reste juste.
          </p>
        </Card>
      )}

      {/* ---- Le grand livre existe et il est vide ----
          Un fait tiré des données, pas une promesse sur l'état du code :
          il restera vrai tant qu'aucun appel n'aura eu lieu, et faux dès
          le premier. */}
      {grandLivreVide && (
        <Card className="mb-6 border-info/30 bg-info-wash px-5 py-4">
          <p className="text-[var(--text-body)] text-info">
            <span className="font-medium">Aucun appel enregistré ce mois-ci.</span> Le détail
            est lisible et vide : ce zéro-ci est un vrai zéro. Chaque sollicitation d&apos;Oasis
            — réussie, en échec ou refusée — y laissera une ligne.
          </p>
        </Card>
      )}

      {tableau.complet === false && (
        <Card className="mb-6 border-warning/30 bg-warning-wash px-5 py-3.5">
          <p className="text-[var(--text-body)] text-warning">
            La lecture du mois a été tronquée : les chiffres ci-dessous portent sur un
            échantillon des appels les plus récents, pas sur le mois entier.
          </p>
        </Card>
      )}

      {/* ---- Les quatre compteurs ---- */}
      <div className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Sollicitations aujourd'hui"
          value={lue ? nombre(tableau.jour.appels) : null}
          hint="depuis minuit, heure de Paris"
        />
        <MetricCard
          label="Sollicitations ce mois"
          value={lue ? nombre(tableau.mois.appels) : null}
          hint={
            tableau.decisionsDistinctes === 0
              ? "aucune analyse de décision"
              : `dont ${tableau.decisionsDistinctes} analyse${tableau.decisionsDistinctes > 1 ? "s" : ""} de décision`
          }
          tone="accent"
        />
        <MetricCard
          label="Texte traité ce mois"
          value={lue ? `${nombre(tableau.mois.jetonsEntree + tableau.mois.jetonsSortie)} jetons` : null}
          hint={`${nombre(tableau.mois.jetonsEntree)} lus · ${nombre(tableau.mois.jetonsSortie)} rédigés`}
        />
        <MetricCard
          label="Temps de réponse moyen"
          value={
            tableau.latenceMoyenneMs === null || !lue
              ? null
              : `${(tableau.latenceMoyenneMs / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} s`
          }
          hint={
            tableau.latenceMoyenneMs === null
              ? "aucun appel à mesurer"
              : "sur l'ensemble des appels du mois"
          }
        />
      </div>

      {/* ---- Les ventilations ---- */}
      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <Ventilation
          titre="Par agent"
          description="Quelle compétence d'Oasis vos équipes sollicitent, et pour quoi."
          lignes={tableau.parAgent}
          nommer={nomAgentDuJournal}
        />
        {peutVoirLesPersonnes ? (
          <Ventilation
            titre="Par personne"
            description="Un compte sans fiche salarié n'a pas de nom : le comptable, un accès temporaire."
            lignes={tableau.parUtilisateur}
            nommer={(cle) =>
              cle === "" ? "Compte supprimé depuis" : (noms.get(cle) ?? "Compte sans fiche salarié")
            }
          />
        ) : (
          <Panel
            title="Par personne"
            description="Qui, dans l'entreprise, sollicite Oasis et combien."
          >
            <p className="px-5 py-5 text-[var(--text-body)] text-ink-soft">
              Cette ventilation est nominative : elle est réservée aux personnes qui gèrent
              l&apos;équipe et les droits. Le reste de la page ne l&apos;est pas — la
              consommation de l&apos;entreprise se lit par tout le monde.
            </p>
          </Panel>
        )}
      </div>

      <Panel
        title="Par décision"
        description="Ce qu'a mobilisé l'analyse d'une décision, du premier appel jusqu'à la recommandation. Les questions posées en conversation libre n'y figurent pas : elles ne sont rattachées à aucune décision."
        className="mb-6"
        count={tableau.decisionsDistinctes}
      >
        {tableau.parDecision.length === 0 ? (
          <p className="px-5 py-5 text-[var(--text-body)] text-ink-soft">
            Aucun appel rattaché à une décision ce mois-ci.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {tableau.parDecision.slice(0, 8).map((ligne) => (
              <li key={ligne.cle} className="flex flex-wrap items-baseline gap-x-3 px-5 py-3">
                <span className="min-w-0 flex-1 truncate text-[var(--text-body)]">
                  {titres.get(ligne.cle) ?? "Décision supprimée depuis"}
                </span>
                <VolumeLigne volume={ligne.volume} />
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {/* ---- Les appels qui n'ont pas abouti ----
          « Limite d'usage atteinte » y figure, et sans montant : le
          client doit savoir que son IA s'est arrêtée, sinon il croit à
          une panne. Il n'a pas à apprendre la somme qui l'a arrêtée —
          elle borne la dépense de l'éditeur, pas la sienne. */}
      {tableau.appelsEnEchec > 0 && (
        <Panel
          title="Demandes qui n'ont pas abouti"
          description="Une demande refusée parce qu'une limite d'usage était atteinte en fait partie : sans elle, une IA arrêtée tout un après-midi ressemblerait à une absence d'activité."
          className="mb-6"
          count={tableau.appelsEnEchec}
        >
          <ul className="divide-y divide-line">
            {tableau.pannes.map((panne) => (
              <li key={panne.motif} className="flex items-baseline gap-3 px-5 py-3">
                <StatusBadge tone={panne.motif === "budget_exceeded" ? "info" : "warning"}>
                  {libellePanneClient(panne.motif)}
                </StatusBadge>
                <span className="tabular ml-auto text-[var(--text-body)]">
                  {nombre(panne.appels)} demande{panne.appels > 1 ? "s" : ""}
                </span>
              </li>
            ))}
          </ul>
          <p className="border-t border-line px-5 py-3.5 text-[var(--text-secondary)] text-ink-soft">
            Une limite d&apos;usage atteinte n&apos;est pas une panne et ne se règle pas depuis
            Oasis Care Pro : elle est posée par Oasis Care sur l&apos;usage du service. Si elle
            revient souvent, c&apos;est une conversation à avoir avec nous, pas un réglage à
            chercher dans cet écran.
          </p>
        </Panel>
      )}

      {/* ---- Les retours (p. 25) ---- */}
      <Panel
        title="Retours de vos équipes"
        description="Est-ce que ce qu'Oasis propose sert vraiment ? Aucun compteur ne le dit à la place de vos équipes."
        className="mb-6"
        action={
          avis.donnees.satisfactionPct !== null ? (
            <Badge tone={avis.donnees.satisfactionPct >= 60 ? "positive" : "warning"}>
              {avis.donnees.satisfactionPct.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %
              utiles
            </Badge>
          ) : undefined
        }
      >
        {avis.etat !== "lue" ? (
          <p className="px-5 py-5 text-[var(--text-body)] text-ink-soft">{avis.message}</p>
        ) : avis.donnees.utiles + avis.donnees.inutiles === 0 ? (
          <div className="px-5 py-5">
            <EmptyState
              title="Personne ne s'est encore prononcé"
              description="Chaque recommandation d'Oasis porte un 👍 et un 👎. Sans eux, on sait ce qu'une analyse a mobilisé, jamais si elle a servi."
              icon={<Icon name="ai" className="h-5 w-5" />}
            />
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-6 px-5 py-4">
              <p className="text-[var(--text-body)]">
                <span className="tabular text-[length:var(--text-card)] font-semibold text-positive">
                  {avis.donnees.utiles}
                </span>{" "}
                <span className="text-ink-soft">utiles</span>
              </p>
              <p className="text-[var(--text-body)]">
                <span className="tabular text-[length:var(--text-card)] font-semibold text-critical">
                  {avis.donnees.inutiles}
                </span>{" "}
                <span className="text-ink-soft">inutiles</span>
              </p>
            </div>
            {avis.donnees.motifs.length > 0 && (
              <ul className="divide-y divide-line border-t border-line">
                {avis.donnees.motifs.map((motif, index) => (
                  <li key={`${motif.quand}-${index}`} className="flex gap-3 px-5 py-3">
                    <span aria-hidden className="shrink-0">
                      {motif.utile ? "👍" : "👎"}
                    </span>
                    <span className="min-w-0 flex-1 text-[var(--text-body)] text-ink-soft">
                      {motif.pourquoi}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </Panel>

      {/* ---- CE QUE CETTE PAGE NE MONTRE PAS, DIT PLUTÔT QUE TU ----
          Un écran qui omet une information sans le dire laisse croire
          qu'elle n'existe pas. Celle-ci existe : elle appartient à
          l'éditeur, et c'est une phrase, pas un secret. */}
      <p className="text-[11px] text-ink-faint">
        « Aujourd&apos;hui » et « ce mois-ci » se comptent en heure de Paris. Cette page ne
        chiffre rien en euros et ne nomme aucun moteur : quel modèle Oasis emploie, à quel
        tarif et dans quelles limites de dépense, c&apos;est Oasis Care qui l&apos;arbitre et
        qui le paie — ce sont des réglages de notre côté, pas des vôtres. Ce que vous payez,
        vous, se lit dans{" "}
        <Link href="/entreprise/abonnement" className="text-accent hover:underline">
          votre abonnement
        </Link>
        .
      </p>
    </div>
  );
}

// ------------------------------------------------------------------
// Le forfait de questions
// ------------------------------------------------------------------

/**
 * « 312 questions sur 500 ce mois-ci », et non « 312 questions posées ».
 *
 * Le compteur existait déjà, en pied de l'écran d'accueil d'Oasis, sous
 * la forme « N question(s) posées ce mois-ci » — un nombre sans
 * dénominateur, dont personne ne pouvait déduire s'il était rassurant.
 * Le plafond, lui, ne se découvrait qu'au refus. C'est l'ordre inverse
 * de ce qu'il faut : une borne s'annonce avant d'être atteinte.
 */
function QuotaCard({
  etat,
  message,
  quota,
}: {
  etat: EtatLecture;
  message: string | null;
  quota: QuotaAssistant;
}) {
  if (etat !== "lue") {
    return (
      <Card className="mb-6 border-warning/30 bg-warning-wash px-5 py-4">
        <p className="text-[var(--text-body)] font-medium text-warning">
          Votre forfait de questions n&apos;a pas pu être lu.
        </p>
        <p className="mt-1 text-[var(--text-secondary)] text-warning">
          {message ?? "Réessayez plus tard."} Ce n&apos;est pas « zéro question posée » : c&apos;est
          inconnu.
        </p>
      </Card>
    );
  }

  const epuise = quota.restant === 0;
  const presDeLaFin = !epuise && quota.partPct >= 80;

  return (
    <Card
      className={`mb-6 px-5 py-4 ${
        epuise ? "border-critical/30" : presDeLaFin ? "border-warning/30" : ""
      }`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-[var(--text-body)]">
          <span className="tabular text-[length:var(--text-card)] font-semibold">
            {nombre(quota.posees)}
          </span>{" "}
          <span className="text-ink-soft">
            question{quota.posees > 1 ? "s" : ""} posée{quota.posees > 1 ? "s" : ""} sur{" "}
            {nombre(quota.plafond)} ce mois-ci
          </span>
        </p>
        <StatusBadge tone={epuise ? "critical" : presDeLaFin ? "warning" : "positive"}>
          {epuise
            ? "Forfait épuisé"
            : `${nombre(quota.restant)} restante${quota.restant > 1 ? "s" : ""}`}
        </StatusBadge>
      </div>

      {/* La barre DOUBLE le chiffre, elle ne le remplace pas (§47 : une
          information portée par la seule couleur disparaît pour un
          daltonien). */}
      <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-[var(--radius-pill)] bg-surface-sunken">
        <div
          className={`h-full ${epuise ? "bg-critical" : presDeLaFin ? "bg-warning" : "bg-positive"}`}
          style={{ width: `${quota.partPct}%` }}
        />
      </div>

      <p className="mt-2.5 text-[var(--text-secondary)] text-ink-soft">
        {epuise ? (
          <>
            <span className="font-medium">Oasis ne répondra plus aux questions ce mois-ci.</span>{" "}
            Le compteur se remet à zéro le 1ᵉʳ du mois. Les analyses automatiques de vos
            décisions, elles, ne consomment pas ce forfait.
          </>
        ) : (
          <>
            Le forfait couvre les questions posées à l&apos;assistant, pour toute
            l&apos;entreprise, et se remet à zéro le 1ᵉʳ du mois. Les analyses qu&apos;Oasis
            mène de lui-même sur vos décisions ne le consomment pas.
          </>
        )}
      </p>
    </Card>
  );
}

// ------------------------------------------------------------------
// Écrire un volume
// ------------------------------------------------------------------

/** Un entier, avec les séparateurs de milliers français. */
function nombre(valeur: number): string {
  return valeur.toLocaleString("fr-FR");
}

function VolumeLigne({ volume }: { volume: Volume }) {
  const jetons = volume.jetonsEntree + volume.jetonsSortie;
  return (
    <span className="tabular shrink-0 text-[var(--text-body)]">
      {nombre(volume.appels)} appel{volume.appels > 1 ? "s" : ""}
      <span className="ml-2 text-[var(--text-secondary)] text-ink-faint">
        {nombre(jetons)} jeton{jetons > 1 ? "s" : ""}
      </span>
    </span>
  );
}

function Ventilation({
  titre,
  description,
  lignes,
  nommer,
}: {
  titre: string;
  description: string;
  lignes: LigneVentilation[];
  nommer: (cle: string) => string;
}) {
  return (
    <Panel title={titre} description={description}>
      {lignes.length === 0 ? (
        <p className="px-5 py-5 text-[var(--text-body)] text-ink-soft">Rien à ventiler.</p>
      ) : (
        <ul className="divide-y divide-line">
          {lignes.slice(0, 8).map((ligne) => (
            <li key={ligne.cle || "sans"} className="flex flex-wrap items-baseline gap-x-3 px-5 py-3">
              <span className="min-w-0 flex-1 truncate text-[var(--text-body)]">
                {nommer(ligne.cle)}
              </span>
              <VolumeLigne volume={ligne.volume} />
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
