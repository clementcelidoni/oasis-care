import Link from "next/link";
import { requireOrganization } from "@/lib/auth/organization";
import {
  Card,
  Badge,
  StatusBadge,
  Panel,
  PageHeader,
  SubmitButton,
  ConfirmDialog,
  DataTable,
  EmptyState,
  type Column,
} from "@/components/ui";
import { centsToInput, formatCents } from "@/lib/quotes/types";
import {
  getAgentsView,
  getAutomationsView,
  type AgentPanel,
  type AutopilotRuleView,
} from "@/lib/ai/agents";
import { setAgentAutonomy, setAgentEnabled, saveAutopilotRule } from "@/lib/ai/agentActions";
import { getAiHistory, confirmationLabel, type HistoryEntry } from "@/lib/ai/history";
import { AGENTS_SANS_DONNEES } from "@/lib/ai/runtime";
import { libelleAgentCatalogue, libellePermission } from "@/lib/ai/etiquettes";
import {
  AGENT_LABELS,
  AGENT_MISSIONS,
  AUTONOMY_LEVELS,
  autonomyLabel,
  isAgentKey,
} from "@/lib/ai/types";

/**
 * §11W — LES RÉGLAGES DE L'IA. TROIS ONGLETS N'EN FONT PLUS QU'UN, ET
 * IL SORT DE LA NAVIGATION.
 *
 * ══════════════════════════════════════════════════════════════════
 * POURQUOI « AGENTS » ET « AUTOMATISATIONS » N'ÉTAIENT QU'UN ÉCRAN
 * ══════════════════════════════════════════════════════════════════
 *
 * Le couplage est STRUCTUREL, pas thématique : une règle d'automatisme
 * ne part QUE si l'agent correspondant est au niveau 4. Régler l'un
 * sans voir l'autre, c'est ne rien régler du tout — et c'est exactement
 * ce que deux onglets imposaient. Le patron qui relevait un plafond
 * sans savoir où en était l'autonomie de l'agent, ou l'inverse, faisait
 * la moitié d'un geste.
 *
 * ══════════════════════════════════════════════════════════════════
 * ET POURQUOI IL N'EST PLUS DANS LA BARRE D'ONGLETS
 * ══════════════════════════════════════════════════════════════════
 *
 * Parce que c'est un réglage d'ENTREPRISE, pas un écran d'assistant.
 * On l'ouvre trois fois par an ; le briefing s'ouvre tous les matins.
 * Lui donner un tiers de la navigation d'Oasis AI, c'était payer chaque
 * jour pour un geste annuel. Il se rejoint par un lien discret dans
 * l'en-tête des deux écrans qui comptent.
 *
 * Sa vraie place est Paramètres › IA, à côté de « Configuration IA » et
 * « Coûts IA » qui y vivent déjà. Le regroupement est fait ; le
 * déplacement ne coûtera plus qu'un `mv`.
 *
 * ══════════════════════════════════════════════════════════════════
 * « HISTORIQUE » DESCEND ICI, ET REND SON NOM
 * ══════════════════════════════════════════════════════════════════
 *
 * Il était un onglet à part entière. En production, il contient quatre
 * lignes, toutes des changements d'autonomie : c'est un journal de
 * RÉGLAGES, et sa place est sous les réglages. Rien n'est perdu — les
 * mêmes colonnes, la même source, le même refus d'afficher « 0 € » pour
 * dire « on ne sait pas ».
 *
 * Et cela libère le mot « historique » pour ce que l'utilisateur avait
 * demandé : ses conversations.
 */
export default async function ReglagesIaPage() {
  const organization = await requireOrganization();

  const [agents, automatisations, journal] = await Promise.all([
    getAgentsView(organization.organizationId, organization.permissions),
    getAutomationsView(organization.organizationId, organization.permissions),
    getAiHistory(organization.organizationId),
  ]);

  const eligibles = automatisations.rules.filter((rule) => rule.eligible);
  const verrouillees = automatisations.rules.filter((rule) => !rule.eligible);

  // COMPTÉ SUR LES PANNEAUX EUX-MÊMES, pas sur une liste écrite dans la
  // phrase. Le texte annonçait « six agents en construction » pendant
  // que trois badges s'affichaient : l'écran se contredisait, et c'est
  // celui où l'on vient chercher précisément cette information.
  const enConstruction = agents.panels.filter((panel) => panel.underConstruction).length;

  return (
    <div className="mx-auto max-w-5xl px-8 py-10">
      <PageHeader
        eyebrow="Oasis Executive AI"
        breadcrumb={{ label: "Oasis AI", href: "/oasis-ai" }}
        title="Réglages de l'IA"
        subtitle="Jusqu'où vous autorisez Oasis à aller, ce qu'il a le droit de faire sans vous, et tout ce qu'il a déjà fait."
        action={
          <StatusBadge tone={automatisations.activeCount > 0 ? "warning" : "neutral"}>
            {automatisations.activeCount === 0
              ? "Aucun automatisme actif"
              : `${automatisations.activeCount} automatisme(s) actif(s)`}
          </StatusBadge>
        }
      />

      {/* Un sommaire, parce que la page est longue par construction et
          qu'on y vient presque toujours pour UNE des trois choses. */}
      <nav aria-label="Sections de cette page" className="mb-8 flex flex-wrap gap-x-5 gap-y-1">
        <a href="#agents" className="text-[var(--text-secondary)] text-accent hover:underline">
          Agents et autonomie
        </a>
        <a
          href="#automatisations"
          className="text-[var(--text-secondary)] text-accent hover:underline"
        >
          Ce qui peut partir sans vous
        </a>
        <a href="#journal" className="text-[var(--text-secondary)] text-accent hover:underline">
          Ce que l&apos;IA a fait
        </a>
        <a href="#limites" className="text-[var(--text-secondary)] text-accent hover:underline">
          Ce qui n&apos;existe pas
        </a>
      </nav>

      {(agents.failed || automatisations.failed) && (
        <Card className="mb-6 border-warning/30 bg-warning-wash px-4 py-3.5">
          <p className="text-[var(--text-body)] font-medium text-warning">
            {agents.failureReason ?? automatisations.failureReason}
          </p>
        </Card>
      )}

      {!agents.canConfigure && !agents.failed && (
        <Card className="mb-6 border-info/30 bg-info-wash px-4 py-3.5">
          <p className="text-[var(--text-body)] text-info">
            Vous consultez ces réglages sans pouvoir les changer. C&apos;est voulu :
            décider de ce qu&apos;une machine a le droit de faire en votre nom est un
            réglage d&apos;entreprise, pas une conduite de chantier. Chacun a le droit de
            SAVOIR ce qu&apos;Oasis peut faire ; seul un administrateur le règle.
          </p>
        </Card>
      )}

      {/* ================================================================
          1. LES AGENTS
          ================================================================ */}
      <section id="agents" className="mb-12 scroll-mt-8">
        <h2 className="mb-1 text-[length:var(--text-section)] font-semibold tracking-tight">
          Agents et autonomie
        </h2>
        {/* LE COMPTE EST CALCULÉ, PAS ÉCRIT. Il annonçait « six » en
            toutes lettres pendant que trois badges seulement
            s'affichaient — l'écran se contredisait à deux paragraphes
            d'intervalle, et c'est précisément ici que le dirigeant vient
            chercher l'information. Le nombre et les badges sortent
            maintenant de la même source, `AGENTS_A_COMPLETER`, elle-même
            déduite du drapeau que porte le fichier de chaque agent. */}
        <p className="mb-4 max-w-2xl text-[var(--text-body)] text-ink-soft">
          Dix agents. Chacun dit ce qu&apos;il surveille, ce qu&apos;il a produit, et
          jusqu&apos;où vous l&apos;autorisez à aller.{" "}
          {enConstruction === 0 ? (
            <>Tous répondent sur l&apos;ensemble de leur domaine.</>
          ) : (
            <>
              {enConstruction === 1
                ? "L'un d'eux est encore en construction : il répond"
                : `${enConstruction} d'entre eux sont encore en construction : ils répondent`}{" "}
              sur une partie seulement de leur domaine, et le disent eux-mêmes plutôt que de
              faire bonne figure.
            </>
          )}
        </p>

        <div className="flex flex-col gap-4">
          {agents.panels.map((panel) => (
            <BlocAgent key={panel.agent} panel={panel} canConfigure={agents.canConfigure} />
          ))}
        </div>

        {/* ──────────────────────────────────────────────────────────
            CE QU'OASIS NE SAIT PAS ENCORE FAIRE, ET POURQUOI.

            LE SILENCE SERAIT PIRE QUE CE TABLEAU. Le document
            d'architecture nomme quatorze agents ; le produit en
            construit dix. Un dirigeant qui a lu ce document cherchera
            « Marché », ne le trouvera pas, et en conclura ce qu'il
            voudra : un oubli, un bogue, une promesse non tenue.

            On lui montre donc les quatre manquants AVEC leur motif
            mesuré et ce qu'il faudrait alimenter d'abord. Un agent sans
            données ne rendrait qu'une phrase polie que personne ne peut
            contredire — et il la facturerait.

            La source est lib/ai/runtime/agents/sansDonnees.ts, sur le
            modèle d'OUTILS_SPEC_SANS_SERVICE : la raison est écrite là
            où la décision a été prise, pas dans cet écran.
            ────────────────────────────────────────────────────────── */}
        <Panel
          title={"Ce qu'Oasis ne sait pas encore faire"}
          count={AGENTS_SANS_DONNEES.length}
          className="mt-8"
        >
          <div className="border-b border-line px-5 py-3.5">
            <p className="text-[var(--text-body)] text-ink-soft">
              Quatre agents décrits dans notre architecture ne sont pas construits, faute
              de données derrière eux. Ce n&apos;est pas un oubli : un agent qui n&apos;a
              rien à lire répond quand même, poliment, et personne ne peut le contredire.
              Voici ce qu&apos;il faudrait alimenter pour les ouvrir.
            </p>
          </div>
          <ul className="divide-y divide-line">
            {AGENTS_SANS_DONNEES.map((entree) => (
              <li key={entree.cle} className="px-5 py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[var(--text-body)] font-medium">{entree.libelle}</p>
                  <Badge tone="neutral">Pas construit</Badge>
                </div>
                <p className="mt-1.5 text-[var(--text-secondary)] text-ink-soft">
                  {entree.motif}
                </p>
                <p className="eyebrow mt-3">À alimenter d&apos;abord</p>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-[var(--text-secondary)] text-ink-soft">
                  {entree.aLivrerDabord.map((etape) => (
                    <li key={etape}>{etape}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </Panel>
      </section>

      {/* ================================================================
          2. LES AUTOMATISATIONS
          ================================================================ */}
      <section id="automatisations" className="mb-12 scroll-mt-8">
        <h2 className="mb-1 text-[length:var(--text-section)] font-semibold tracking-tight">
          Ce qui peut partir sans vous
        </h2>
        <p className="mb-4 max-w-2xl text-[var(--text-body)] text-ink-soft">
          Et surtout ce qui n&apos;aura jamais le droit de partir sans vous.
        </p>

        <Card className="mb-6 px-5 py-4">
          <p className="text-[var(--text-body)] font-medium">
            Un automatisme actif exécute sans que personne valide.
          </p>
          <p className="mt-1 text-[var(--text-secondary)] text-ink-soft">
            Il ne partira que si TOUTES les conditions sont réunies : l&apos;agent est
            réglé au niveau 4, la règle est allumée, le montant tient sous le plafond, et
            l&apos;utilisateur au nom de qui il agit détient le droit correspondant. Une
            seule condition inconnue suffit à refuser — le doute vaut refus, y compris
            quand le montant de l&apos;action n&apos;est pas connu.
          </p>
          {/* CE PARAGRAPHE EST LE PLUS IMPORTANT DE L'ÉCRAN, ET IL A DÉJÀ
              ÉTÉ FAUX UNE FOIS. Il promettait que toute action passait par
              une validation humaine enregistrée : vrai du balayage de
              fond, qui n'existe pas ; faux de l'assistant, qui exécute
              sans rien demander dès qu'un agent est au niveau 4 (voir
              `supabase/functions/oasis-pro-ai/index.ts`, branche
              « autopilote »). Un patron qui relève un plafond après avoir
              lu qu'il n'arme rien a été trompé par cet écran.

              `lib/ai/coherence.test.ts` lie les deux surfaces : tant que
              cette branche existe, ce paragraphe ne peut plus nier
              qu'elle existe. */}
          <p className="mt-3 rounded-[var(--radius-control)] bg-surface-sunken px-3.5 py-2.5 text-[var(--text-secondary)] text-ink-soft">
            <strong className="font-medium">
              Ce qu&apos;allumer une règle déclenche, exactement.
            </strong>{" "}
            Aucune analyse planifiée ne tourne en arrière-plan : Oasis ne se réveille pas
            la nuit pour facturer. Mais un agent réglé au niveau 4 exécutera sans
            confirmation dès qu&apos;on le sollicitera — depuis une conversation, en lui
            demandant par exemple de préparer les factures. Tant que le plafond ci-dessous
            vaut 0 €, rien ne passe : le relever est le geste qui arme réellement
            l&apos;automatisme.
          </p>
        </Card>

        {eligibles.length > 0 && (
          <Panel title="Ce qui peut être automatisé" count={eligibles.length}>
            <ul className="divide-y divide-line">
              {eligibles.map((rule) => (
                <LigneRegle
                  key={rule.actionType}
                  rule={rule}
                  canConfigure={automatisations.canConfigure}
                />
              ))}
            </ul>
          </Panel>
        )}

        {verrouillees.length > 0 && (
          <div className="mt-6">
            <Panel
              title="Ce qui ne peut pas l'être"
              description="Verrouillé en base, pas éteint par réglage. Ouvrir l'un de ces automatismes demande une migration — délibérément la voie la plus lente."
              count={verrouillees.length}
            >
              <ul className="divide-y divide-line">
                {verrouillees.map((rule) => (
                  <li
                    key={rule.actionType}
                    className="flex flex-wrap items-start gap-3 px-5 py-3.5"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-[var(--text-body)] font-medium">
                        {rule.label}
                        <span className="ml-2 text-[var(--text-secondary)] font-normal text-ink-faint">
                          {libelleAgentCatalogue(rule.agent)}
                        </span>
                      </p>
                      {rule.description && (
                        <p className="mt-0.5 text-[var(--text-secondary)] text-ink-soft">
                          {rule.description}
                        </p>
                      )}
                    </div>
                    <StatusBadge tone="neutral">Verrouillé</StatusBadge>
                  </li>
                ))}
              </ul>
            </Panel>
          </div>
        )}
      </section>

      {/* ================================================================
          3. LE JOURNAL
          ================================================================ */}
      <section id="journal" className="mb-12 scroll-mt-8">
        <h2 className="mb-1 text-[length:var(--text-section)] font-semibold tracking-tight">
          Ce que l&apos;IA a fait
        </h2>
        <p className="mb-4 max-w-2xl text-[var(--text-body)] text-ink-soft">
          Tout ce qu&apos;Oasis a fait, ou tenté de faire, au nom de cette entreprise.
          Rien n&apos;y est effaçable depuis l&apos;application.
        </p>
        <JournalIa journal={journal} />
      </section>

      {/* ================================================================
          4. TROIS CARTES D'HONNÊTETÉ N'EN FONT PLUS QU'UNE
          ================================================================ */}
      <section id="limites" className="scroll-mt-8">
        <h2 className="mb-1 text-[length:var(--text-section)] font-semibold tracking-tight">
          Ce qui n&apos;existe pas
        </h2>
        <p className="mb-4 max-w-2xl text-[var(--text-body)] text-ink-soft">
          Les taire laisserait croire qu&apos;on les a oubliées, et quelqu&apos;un les
          chercherait longtemps. Elles occupaient le tiers bas de trois écrans
          différents ; elles tiennent ici.
        </p>

        <Card className="divide-y divide-line">
          {/* CE BLOC A ÉTÉ FAUX, ET IL L'EST RESTÉ LONGTEMPS. Il
              s'intitulait « Les neuf agents non construits » et nommait
              Opérations, Planning, Pépinière, Flotte et Client parmi
              eux — cinq agents qui répondent aujourd'hui, avec leurs
              propres sources. Écrit à l'époque des quatre premiers, il
              n'a pas suivi, et il contredisait le panneau « Ce
              qu'Oasis ne sait pas encore faire » deux sections plus
              haut : deux comptes différents sur le même écran, dont le
              plus visible était le périmé.

              Il ne nomme donc plus personne en dur. Le compte vient de
              `AGENTS_SANS_DONNEES`, qui est aussi la source du panneau
              du haut : une seule vérité, et elle ne peut plus vieillir
              toute seule. */}
          <div className="px-5 py-4">
            <h3 className="text-[var(--text-body)] font-medium">
              {AGENTS_SANS_DONNEES.length === 1
                ? "L'agent que nous n'avons pas construit"
                : `Les ${AGENTS_SANS_DONNEES.length} agents que nous n'avons pas construits`}
            </h3>
            <p className="mt-1 text-[var(--text-secondary)] text-ink-soft">
              {AGENTS_SANS_DONNEES.map((entree) => entree.libelle).join(", ")} sont décrits
              par la spécification, et nous ne les avons pas construits : il n&apos;y a rien
              derrière eux à lire. Ce ne sont pas des agents éteints — la base refuse leur
              nom, et aucune décision ne peut être ouverte à leur compte. Le détail de ce
              qu&apos;il faudrait alimenter d&apos;abord est plus haut, dans «&nbsp;Ce
              qu&apos;Oasis ne sait pas encore faire&nbsp;».
            </p>
          </div>

          <div className="px-5 py-4">
            <h3 className="text-[var(--text-body)] font-medium">
              Les limites qui ne se règlent pas encore ici
            </h3>
            <p className="mt-1 text-[var(--text-secondary)] text-ink-soft">
              Les listes de fournisseurs et de clients autorisés, et la plage horaire,
              existent en base et sont respectées par le moteur — mais elles ne se
              modifient pas depuis cet écran dans cette version. Tant qu&apos;elles sont
              vides, elles ne restreignent rien ; une fois renseignées, elles refusent
              tout ce qu&apos;elles ne savent pas rattacher explicitement, y compris une
              action sans cible. Une liste blanche qu&apos;on ne sait pas vérifier doit
              fermer, pas s&apos;effacer.
            </p>
          </div>

          <div className="px-5 py-4">
            <h3 className="text-[var(--text-body)] font-medium">
              Les onze gestes qu&apos;Oasis n&apos;a aucun moyen de faire
            </h3>
            <p className="mt-1 text-[var(--text-secondary)] text-ink-soft">
              Envoyer un devis, émettre une facture ou un avoir, encaisser un règlement,
              envoyer une commande, réceptionner une marchandise, valider un pointage,
              faire signer une intervention, livrer un jardin, supprimer ou archiver quoi
              que ce soit, ni modifier les droits d&apos;un membre. Ces gestes engagent
              juridiquement, ou ne se rejouent pas. Ce n&apos;est pas un réglage : ils
              n&apos;ont tout simplement pas d&apos;outil.
            </p>
            <p className="mt-2 text-[var(--text-secondary)] text-ink-soft">
              En revanche il PRÉPARE : un client ou un prospect, une opportunité, une note
              d&apos;échange, un brouillon de devis et ses lignes, un article de catalogue,
              un chantier avec ses phases, une intervention au planning, un lot de
              pépinière, un mouvement de stock, une commande fournisseur en brouillon.
              Chaque fois : une proposition, et votre clic.
            </p>
          </div>
        </Card>
      </section>

      <p className="mt-8 text-[11px] text-ink-faint">
        Les gestes faits à la main ailleurs dans le produit sont dans le journal des
        opérations, sous Paramètres — cette page ne montre que ce qui porte la signature
        d&apos;Oasis.{" "}
        <Link href="/oasis-ai" className="text-accent hover:underline">
          Retour à Oasis AI
        </Link>
        .
      </p>
    </div>
  );
}

// ==================================================================
// Un agent
// ==================================================================

function BlocAgent({ panel, canConfigure }: { panel: AgentPanel; canConfigure: boolean }) {
  const label = AGENT_LABELS[panel.agent];

  return (
    <Panel
      title={label}
      description={AGENT_MISSIONS[panel.agent]}
      action={
        <>
          {/* EN CONSTRUCTION N'EST PAS « ÉTEINT ». L'agent répond ; il
              répond sur une partie de son domaine seulement, et ses
              limites nomment le reste. Confondre les deux ferait
              chercher un interrupteur qui n'existe pas. */}
          {panel.underConstruction && <Badge tone="neutral">En construction</Badge>}
          <StatusBadge tone={panel.enabled ? "positive" : "neutral"}>
            {panel.enabled ? "Actif" : "En veille"}
          </StatusBadge>
          <Badge tone={panel.autonomy === 4 ? "critical" : "accent"}>
            {autonomyLabel(panel.autonomy)}
          </Badge>
        </>
      }
    >
      <div className="grid gap-x-6 gap-y-4 px-5 py-4 sm:grid-cols-3">
        <Mesure
          label="Dernière analyse"
          value={
            panel.lastAnalysis
              ? new Date(panel.lastAnalysis).toLocaleString("fr-FR", {
                  day: "numeric",
                  month: "long",
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : null
          }
          /* « Jamais » et « pas encore mesuré » sont la même chose ici,
             et la phrase le dit sans prétendre à une date. */
          fallback="Aucune trace au journal."
        />
        <Mesure
          label="Décisions ouvertes"
          value={
            panel.openDecisions > 0 ? (
              <Link href="/oasis-ai" className="text-accent hover:underline">
                {panel.openDecisions}
              </Link>
            ) : (
              "0"
            )
          }
        />
        <div>
          <p className="eyebrow">Droits exigés de vous</p>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {/* EN FRANÇAIS, PAS EN `quotes.edit`. Un identifiant technique
                dans une phrase française est une fuite d'implémentation,
                pas une information de plus. */}
            {panel.permissions.map((row) => (
              <Badge key={row.permission} tone={row.granted ? "positive" : "critical"}>
                {libellePermission(row.permission)}
                {row.granted ? "" : " — manquant"}
              </Badge>
            ))}
          </div>
        </div>
      </div>

      {panel.blocked && (
        <div className="border-t border-line bg-warning-wash px-5 py-3">
          <p className="text-[var(--text-body)] text-warning">
            Il manque à votre rôle un droit que cet agent exige. Il ne se taira pas : il
            rendra une réponse amputée qui NOMME ce qu&apos;il n&apos;a pas pu lire. Une
            réponse partielle qui se dénonce vaut mieux qu&apos;un zéro qui a l&apos;air
            d&apos;un fait.
          </p>
        </div>
      )}

      {/* ---- Le réglage d'autonomie ---- */}
      <div className="border-t border-line px-5 py-4">
        <p className="eyebrow mb-2">Autonomie</p>
        <div className="flex flex-col gap-2">
          {AUTONOMY_LEVELS.map((level) => {
            const courant = level.level === panel.autonomy;
            return (
              <div
                key={level.level}
                className={`flex flex-wrap items-center gap-3 rounded-[var(--radius-control)] border px-3.5 py-2.5 ${
                  courant ? "border-accent bg-accent-wash/40" : "border-line bg-surface"
                } ${level.level === 4 && !courant ? "border-critical/25" : ""}`}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-[var(--text-body)] font-medium">
                    Niveau {level.level} — {level.label}
                    {courant && (
                      <span className="ml-2 text-[var(--text-secondary)] font-normal text-accent">
                        réglage actuel
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 text-[var(--text-secondary)] text-ink-soft">
                    {level.description}
                  </p>
                </div>

                {!courant && canConfigure && (
                  <div className="shrink-0">
                    {level.level === 4 ? (
                      /* LE SEUL RÉGLAGE DE L'APPLICATION QUI LAISSE LA
                         MACHINE AGIR SEULE. Une boîte de dialogue, et un
                         jeton que la Server Action exige. Le jeton n'est
                         pas une sécurité — un formulaire se forge — c'est
                         un verrou de conception : on ne peut pas ajouter
                         par distraction un second chemin vers
                         l'autopilote qui sauterait la confirmation. */
                      <ConfirmDialog
                        triggerLabel="Activer l'autopilote"
                        triggerVariant="danger"
                        title="Laisser cet agent agir seul ?"
                        message={
                          "Au niveau 4, l'agent exécute sans que personne valide. Il ne pourra le faire " +
                          "que pour les actions explicitement autorisées dans les automatisations, sous leur " +
                          "plafond, et jamais pour envoyer une facture, passer une commande ou modifier un " +
                          "tarif : ces trois-là sont verrouillées en base. Vous pourrez revenir en arrière à " +
                          "tout moment, mais pas défaire ce qui sera parti. " +
                          "Aucune analyse ne tourne en arrière-plan, mais dès que quelqu'un sollicitera " +
                          "cet agent depuis une conversation, il agira sans vous demander. Le plafond des " +
                          "automatisations reste le dernier frein : à 0 €, rien ne passe."
                        }
                        confirmLabel="J'active l'autopilote"
                        confirmVariant="danger"
                        action={setAgentAutonomy}
                        hidden={{
                          agent: panel.agent,
                          level: "4",
                          confirmAutopilot: "oui",
                        }}
                      />
                    ) : (
                      <form action={setAgentAutonomy}>
                        <input type="hidden" name="agent" value={panel.agent} />
                        <input type="hidden" name="level" value={String(level.level)} />
                        <SubmitButton variant="secondary">Choisir</SubmitButton>
                      </form>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {canConfigure && (
          <form action={setAgentEnabled} className="mt-3">
            <input type="hidden" name="agent" value={panel.agent} />
            <input type="hidden" name="enabled" value={panel.enabled ? "0" : "1"} />
            <SubmitButton variant="ghost">
              {panel.enabled ? "Mettre cet agent en veille" : "Réactiver cet agent"}
            </SubmitButton>
          </form>
        )}
      </div>
    </Panel>
  );
}

function Mesure({
  label,
  value,
  fallback = "—",
}: {
  label: string;
  value: React.ReactNode;
  fallback?: string;
}) {
  const vide = value === null || value === undefined || value === "";
  return (
    <div>
      <p className="eyebrow">{label}</p>
      <p className={`mt-1 text-[var(--text-body)] ${vide ? "text-ink-faint" : "font-medium"}`}>
        {vide ? fallback : value}
      </p>
    </div>
  );
}

// ==================================================================
// Une règle d'automatisme
// ==================================================================

function LigneRegle({
  rule,
  canConfigure,
}: {
  rule: AutopilotRuleView;
  canConfigure: boolean;
}) {
  return (
    <li className="px-5 py-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[var(--text-body)] font-medium">
            {rule.label}
            <span className="ml-2 text-[var(--text-secondary)] font-normal text-ink-faint">
              {libelleAgentCatalogue(rule.agent)}
            </span>
          </p>
          {rule.description && (
            <p className="mt-0.5 text-[var(--text-secondary)] text-ink-soft">
              {rule.description}
            </p>
          )}
          <p className="mt-1 text-[var(--text-secondary)] text-ink-faint">
            {/* Plus de `<code>quotes.edit</code>` au milieu d'une phrase
                française. */}
            L&apos;utilisateur doit pouvoir {libellePermission(rule.requiredPermission)}
            {rule.carriesAmount
              ? " · engage de l'argent : un montant inconnu fait refuser l'exécution."
              : " · n'engage aucun montant."}
          </p>
        </div>

        <StatusBadge tone={rule.enabled ? "warning" : "neutral"}>
          {rule.enabled ? "Actif" : "Éteint"}
        </StatusBadge>
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-3">
        {rule.carriesAmount && (
          <div>
            <p className="eyebrow">Plafond par action</p>
            {/* Un plafond à zéro et un plafond inconnu s'affichent tous
                deux en gris, mais pas avec le même texte : le premier dit
                « rien ne passe », le second « aucune règle posée ». */}
            <p
              className={`tabular mt-0.5 text-[var(--text-body)] ${
                rule.maximumAmountCents !== null && rule.maximumAmountCents > 0
                  ? "font-medium"
                  : "text-ink-faint"
              }`}
            >
              {formatCents(rule.maximumAmountCents)}
              {rule.maximumAmountCents === 0 && (
                <span className="ml-2 text-[var(--text-secondary)] font-normal text-ink-faint">
                  aucun engagement financier automatique
                </span>
              )}
            </p>
          </div>
        )}

        {canConfigure && (
          <div className="ml-auto flex flex-wrap items-end gap-2">
            {rule.carriesAmount && (
              <form action={saveAutopilotRule} className="flex items-end gap-2">
                <input type="hidden" name="actionType" value={rule.actionType} />
                <input type="hidden" name="enabled" value={rule.enabled ? "1" : "0"} />
                {/* Le jeton n'accompagne le formulaire de plafond que si
                    la règle est DÉJÀ active : changer un plafond n'est
                    pas une activation, mais l'enregistrement repasse par
                    la même fonction, et celle-ci exige le jeton dès que
                    `enabled` vaut 1. */}
                {rule.enabled && <input type="hidden" name="confirmAutopilot" value="oui" />}
                <label className="flex flex-col gap-1">
                  <span className="eyebrow">Nouveau plafond (€)</span>
                  <input
                    name="maximumAmount"
                    inputMode="decimal"
                    defaultValue={centsToInput(rule.maximumAmountCents)}
                    placeholder="0,00"
                    className="w-32 rounded-[var(--radius-control)] border border-line-strong bg-surface px-3 py-2 text-[var(--text-body)] outline-none focus:border-accent"
                  />
                </label>
                <SubmitButton variant="secondary">Enregistrer</SubmitButton>
              </form>
            )}

            {rule.enabled ? (
              <form action={saveAutopilotRule}>
                <input type="hidden" name="actionType" value={rule.actionType} />
                <input type="hidden" name="enabled" value="0" />
                <SubmitButton variant="secondary">Éteindre</SubmitButton>
              </form>
            ) : (
              <ConfirmDialog
                triggerLabel="Activer"
                triggerVariant="danger"
                title={`Laisser Oasis « ${rule.label.toLowerCase()} » sans validation ?`}
                message={
                  `Une fois actif, cet automatisme s'exécute sans que personne le valide, ` +
                  (rule.carriesAmount
                    ? `dans la limite du plafond enregistré (${formatCents(rule.maximumAmountCents)}). Un plafond à zéro bloque tout : relevez-le d'abord si vous voulez qu'il serve. `
                    : "") +
                  `Il ne partira que si l'agent correspondant est réglé au niveau 4 et si l'utilisateur au nom de qui il agit peut ${libellePermission(rule.requiredPermission)}.`
                }
                confirmLabel="J'active cet automatisme"
                confirmVariant="danger"
                action={saveAutopilotRule}
                hidden={{
                  actionType: rule.actionType,
                  enabled: "1",
                  confirmAutopilot: "oui",
                  maximumAmount: "",
                }}
              />
            )}
          </div>
        )}
      </div>
    </li>
  );
}

// ==================================================================
// Le journal
// ==================================================================

/**
 * §11V — HISTORY (spec p. 41) : « date · agent · décision · utilisateur
 * · action · résultat · impact ».
 *
 * « Toutes les actions importantes doivent être traçables, auditables,
 * explicables » (p. 3). Les trois ne valent rien si personne ne peut
 * les LIRE : un journal qu'il faut interroger en SQL est un journal qui
 * n'existe pas pour le chef d'entreprise.
 *
 * L'IMPACT EST CELUI QUI A ÉTÉ CONSTATÉ, jamais celui qui avait été
 * annoncé — et quand il n'existe pas, la cellule porte un tiret, pas un
 * zéro. Un journal qui affiche « 0 € » sur une action dont on ne sait
 * pas chiffrer l'effet raconte une histoire fausse, avec l'autorité
 * d'un journal.
 */
function JournalIa({ journal }: { journal: Awaited<ReturnType<typeof getAiHistory>> }) {
  const colonnes: Column<HistoryEntry>[] = [
    {
      key: "date",
      header: "Date",
      cell: (row) => (
        <span className="tabular whitespace-nowrap">
          {new Date(row.occurredAt).toLocaleString("fr-FR", {
            day: "2-digit",
            month: "2-digit",
            year: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      ),
      width: "9rem",
    },
    {
      key: "agent",
      header: "Agent",
      cell: (row) =>
        row.agent ? (
          <Badge tone="neutral">
            {isAgentKey(row.agent) ? AGENT_LABELS[row.agent] : libelleAgentCatalogue(row.agent)}
          </Badge>
        ) : (
          <span className="text-ink-faint">—</span>
        ),
      width: "8rem",
    },
    {
      key: "action",
      header: "Action",
      cell: (row) => (
        <span>
          <span className="block font-medium">{row.action}</span>
          {row.decisionTitle && (
            <span className="block text-[var(--text-secondary)] text-ink-soft">
              {row.decisionTitle}
            </span>
          )}
        </span>
      ),
    },
    {
      key: "user",
      header: "Utilisateur",
      cell: (row) =>
        row.actorName ? (
          row.actorName
        ) : row.actorUserId ? (
          /* Un identifiant sans nom : le compte n'a pas de fiche
             salarié. On le dit plutôt que d'afficher un UUID, qui ne
             désigne personne pour un lecteur humain. */
          <span className="text-ink-faint">compte sans fiche</span>
        ) : (
          <span className="text-ink-faint">traitement automatique</span>
        ),
      secondary: true,
      width: "10rem",
    },
    {
      key: "confirmation",
      header: "Confirmation",
      cell: (row) => (
        <span className="text-ink-soft">{confirmationLabel(row.confirmation) ?? "—"}</span>
      ),
      secondary: true,
      width: "9rem",
    },
    {
      key: "result",
      header: "Résultat",
      cell: (row) => (
        <span
          className={
            row.succeeded === false ? "text-critical" : row.outcome ? "" : "text-ink-faint"
          }
        >
          {row.outcome ?? (row.succeeded === true ? "Fait." : "—")}
        </span>
      ),
    },
    {
      key: "impact",
      header: "Impact",
      numeric: true,
      cell: (row) => (
        <span className={row.impactCents === null ? "text-ink-faint" : ""}>
          {formatCents(row.impactCents)}
        </span>
      ),
      width: "8rem",
    },
  ];

  if (journal.failed) {
    return (
      <Card className="border-warning/30 bg-warning-wash px-4 py-3.5">
        <p className="text-[var(--text-body)] font-medium text-warning">
          {journal.failureReason}
        </p>
        <p className="mt-1 text-[var(--text-secondary)] text-warning">
          Ce n&apos;est pas « aucune activité » : le journal n&apos;a pas pu être lu.
        </p>
      </Card>
    );
  }

  return (
    <DataTable
      columns={colonnes}
      rows={journal.entries}
      rowKey={(row) => row.id}
      empty={
        <EmptyState
          title="Oasis n'a encore rien fait ici."
          description="Chaque décision ouverte, chaque validation, chaque action exécutée viendra s'inscrire ici avec son agent, son auteur, son résultat et son impact."
        />
      }
      footer={
        <p className="text-[var(--text-secondary)] text-ink-faint">
          Les {journal.entries.length} derniers événements.
        </p>
      }
    />
  );
}

export const dynamic = "force-dynamic";
