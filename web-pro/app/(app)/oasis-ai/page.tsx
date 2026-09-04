import Link from "next/link";
import { requireOrganization } from "@/lib/auth/organization";
import { createClient } from "@/lib/supabase/server";
import {
  Card,
  Badge,
  EmptyState,
  Panel,
  PageHeader,
  SubmitButton,
  type Tone,
} from "@/components/ui";
import { formatCents } from "@/lib/quotes/types";
import { formatDate } from "@/lib/crm/types";
import { parisDay } from "@/lib/field/types";
import { getOasisDaily, briefingCount, type DailyPriorities } from "@/lib/ai/daily";
import { runExecutiveScan } from "@/lib/ai/scan";
import { getConversationApprovals, getDecisionBoard } from "@/lib/ai/decisions";
import { answerApproval } from "@/lib/ai/engine";
import { catalogIndex, getActionCatalog } from "@/lib/ai/registry";
import { lireMesAvis } from "@/lib/ai/admin/lecture";
import { libelleRubrique } from "@/lib/ai/etiquettes";
import {
  CATEGORY_LABELS,
  CONFIDENCE_LABELS,
  CONFIDENCE_TONES,
  DECISION_CATEGORIES,
  RISK_LABELS,
  RISK_TONES,
  isDecisionCategory,
  isInsufficient,
  type BriefItem,
  type DecisionCategory,
} from "@/lib/ai/types";
import type { OrphanApproval } from "@/lib/ai/decisions";
import { OasisTabs, LienReglages } from "./OasisTabs";
import { Explanation } from "./Explanation";
import { DecisionCard } from "./decisions/DecisionCard";
import { Composeur } from "./conversations/Composeur";
import { buildConfirmMessages } from "./decisions/confirmations";

/**
 * §11W — « AUJOURD'HUI ». DEUX ÉCRANS N'EN FONT PLUS QU'UN.
 *
 * ══════════════════════════════════════════════════════════════════
 * POURQUOI LA FUSION, ET SUR QUELLE PREUVE
 * ══════════════════════════════════════════════════════════════════
 *
 * « Daily » et « Décisions » lisaient LA MÊME FONCTION SQL.
 * `ai_oasis_daily` appelle `ai_executive_brief` (0073) ; le balayage
 * `runExecutiveScan` appelle `ai_executive_brief`. Les deux écrans
 * affichaient donc les mêmes constats, avec le même composant
 * `Explanation`. La seule différence pour l'utilisateur : l'un avait
 * des boutons, l'autre non — et l'autre lui disait d'aller cliquer
 * dans le premier.
 *
 * Un détail d'implémentation — lire, puis écrire — avait été promu au
 * rang de navigation. La fusion ne supprime rien : le briefing garde
 * ses sept listes de faits datés, les décisions gardent leurs cinq
 * boutons, leur « Pourquoi ? », leur pouce — et leur filtre par
 * catégorie, avec ses compteurs et son `?categorie=`, qui avait failli
 * y rester.
 *
 * ══════════════════════════════════════════════════════════════════
 * TROIS CHOSES RESTENT NON NÉGOCIABLES
 * ══════════════════════════════════════════════════════════════════
 *
 *   1. AUCUN MODÈLE N'EST APPELÉ ICI. Le briefing est du SQL : des
 *      faits datés, des sommes lues, un classement déterministe. Il
 *      marche sans clé OpenAI, sans latence, et sans risque
 *      d'invention. Le modèle sert dans les conversations.
 *
 *   2. CHAQUE LIGNE PORTE SON « POURQUOI ? » (spec p. 6). C'est un
 *      critère de validation à lui seul.
 *
 *   3. « RIEN À SIGNALER » NE S'AFFICHE QUE QUAND C'EST VRAI. Un
 *      briefing qui n'a pas pu être établi le dit ; il ne se déguise
 *      pas en matinée calme.
 *
 * ─── LE CHAMP DE QUESTION EST EN BAS, ET C'EST DÉLIBÉRÉ ───
 *
 * À sept heures du matin, on ne sait pas encore quoi demander. Le
 * critère de validation du produit (spec p. 49) est d'OUVRIR ET DE
 * VOIR. Un champ vide en haut de l'écran demanderait à l'utilisateur de
 * faire lui-même le travail pour lequel il a ouvert l'application.
 */
export default async function OasisAujourdhuiPage({
  searchParams,
}: PageProps<"/oasis-ai">) {
  const organization = await requireOrganization();
  const params = await searchParams;

  // « Voir aussi les décisions déjà tranchées » : la fonction existait
  // dans l'ancien centre de décision, elle suit la fusion. Elle reste
  // une URL, donc partageable et rechargeable.
  const toutVoir = params.tout === "1";

  // LE FILTRE PAR CATÉGORIE SUIT LA FUSION LUI AUSSI.
  //
  // Il avait disparu en chemin, alors que l'en-tête de ce fichier
  // affirmait « la fusion ne supprime rien ». Les cinq catégories, leurs
  // compteurs et l'URL `?categorie=` sont de retour à l'identique : les
  // données étaient toujours calculées (`board.openByCategory`), et
  // `getDecisionBoard` accepte toujours `category`.
  const categorieBrute = typeof params.categorie === "string" ? params.categorie : null;
  const categorie: DecisionCategory | undefined = isDecisionCategory(categorieBrute)
    ? categorieBrute
    : undefined;

  const [{ briefing, priorities }, board, catalog, conversationApprovals] = await Promise.all([
    getOasisDaily(organization.organizationId),
    getDecisionBoard(organization.organizationId, {
      scope: toutVoir ? "all" : "open",
      category: categorie,
    }),
    getActionCatalog(),
    getConversationApprovals(organization.organizationId),
  ]);

  const supabase = await createClient();
  const { data: usage } = await supabase
    .from("ai_pro_usage")
    .select("used")
    // LE MOIS VÉCU À PARIS, pas le mois UTC. Le 1er du mois entre
    // minuit et deux heures, `toISOString()` rend encore le mois
    // précédent : l'écran lisait alors le quota du mois d'avant. C'est
    // l'écart que la migration 0066 existe pour corriger ailleurs, et
    // `parisDay` est la correction que le planning a déjà faite.
    .eq("period", parisDay(new Date()).slice(0, 7))
    .maybeSingle();

  // Le droit d'écrire dans `ai_actions` et de répondre à une décision
  // (0072, section 14 : l'opérationnel suit le régime du chantier).
  const canAct = organization.permissions.includes("projects.manage");

  const mesAvis = await lireMesAvis(
    organization.organizationId,
    board.items.map((item) => item.decision.id),
  );

  const index = catalogIndex(catalog.entries);
  const confirmMessages = await buildConfirmMessages(
    organization.organizationId,
    board.items.some((item) =>
      JSON.stringify(item.decision.available_actions ?? "").includes("createInvoiceDraft"),
    ),
  );

  // ─── LES CONSTATS QUI N'ONT PAS ENCORE DE DÉCISION ───
  //
  // Le balayage recopie `item.titre` dans `ai_decisions.title` sans le
  // toucher (voir `lib/ai/scan.ts`) : le titre est donc le lien exact
  // entre les deux surfaces, et pas une heuristique. Une ligne déjà
  // portée par une décision ne s'affiche pas deux fois — c'était
  // précisément le défaut de la séparation en deux onglets.
  const titresTraites = new Set(board.items.map((item) => item.decision.title));
  const rubriques = briefing.rubriques
    .map((rubrique) => ({
      ...rubrique,
      elements: rubrique.elements.filter((element) => !titresTraites.has(element.titre)),
    }))
    .filter((rubrique) => rubrique.elements.length > 0);

  const constatsSansDecision = rubriques.reduce((n, r) => n + r.elements.length, 0);
  const recommendations = briefingCount(briefing);
  const today = briefing.date ? new Date(briefing.date) : new Date();
  const faitsDuJour = compterFaits(priorities);

  // « Oasis n'a rien à dire » ne se dit QUE si rien n'est lisible nulle
  // part. Une carte en pointillés posée par-dessus sept listes de faits
  // vrais effacerait des faits vrais.
  const totalementVide =
    !briefing.failed &&
    // Un filtre actif cache par construction : « Oasis n'a rien à vous
    // dire » serait faux, et les compteurs juste au-dessus le
    // démentiraient.
    categorie === undefined &&
    board.items.length === 0 &&
    constatsSansDecision === 0 &&
    conversationApprovals.length === 0 &&
    faitsDuJour === 0 &&
    !priorities.failed;

  return (
    <div className="mx-auto max-w-5xl px-8 py-10">
      <PageHeader
        eyebrow="Oasis Executive AI"
        title="Oasis AI"
        subtitle={`Le copilote de direction de ${organization.name}. Il lit vos données avec VOS droits, explique ce qu'il conclut, et n'écrit rien sans votre clic.`}
        action={
          <>
            <LienReglages />
            {/* UN SEUL « Lancer l'analyse » DANS TOUT L'ESPACE. Il y en
                avait trois pour un même `runExecutiveScan` : un par
                en-tête, plus un dans l'état vide. */}
            <form action={runExecutiveScan}>
              <SubmitButton variant="secondary">Lancer l&apos;analyse</SubmitButton>
            </form>
          </>
        }
      />

      <OasisTabs current="/oasis-ai" openDecisions={board.openTotal} />

      {/* ---- Le bonjour, la date, la confiance ---- */}
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[length:var(--text-section)] font-semibold tracking-tight">
            {briefing.salutation}.
          </h2>
          <p className="mt-1 text-[var(--text-body)] text-ink-soft">
            {today.toLocaleDateString("fr-FR", {
              weekday: "long",
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
            {recommendations > 0 &&
              ` — ${recommendations} recommandation${recommendations > 1 ? "s" : ""} ce matin.`}
          </p>
        </div>
        {/* LA CONFIANCE NE S'AFFICHE QU'EN « MOYENNE » OU « FAIBLE ».
            Élevée est le défaut ; l'écrire à chaque matin apprend à ne
            plus lire le badge, donc à rater « faible » le jour où il
            compte. Et « données insuffisantes » n'est pas une confiance
            basse : sur un matin sans rien à signaler, `ai_oasis_daily`
            rend cette valeur — exacte, mais illisible à côté d'une
            phrase qui dit que tout va bien. */}
        {!briefing.failed &&
          recommendations > 0 &&
          briefing.confiance !== "high" &&
          !isInsufficient(briefing.confiance) && (
            <Badge tone={CONFIDENCE_TONES[briefing.confiance]}>
              Confiance : {CONFIDENCE_LABELS[briefing.confiance].toLowerCase()}
            </Badge>
          )}
      </div>

      {/* ---- Ce qu'Oasis n'a pas pu regarder ---- */}
      {briefing.failed && (
        <Card className="mb-6 border-warning/30 bg-warning-wash px-4 py-3.5">
          <p className="text-[var(--text-body)] font-medium text-warning">
            Le briefing du matin n&apos;a pas pu être établi.
          </p>
          <p className="mt-1 text-[var(--text-secondary)] text-warning">
            {briefing.failureReason} Ce n&apos;est pas « rien à signaler » : c&apos;est
            « je n&apos;ai pas pu regarder ».
          </p>
        </Card>
      )}

      {briefing.droitsManquants.length > 0 && (
        /* §"un agent agit avec les permissions de l'utilisateur" : un
           brief amputé qui se nomme vaut mieux qu'un brief complet
           mensonger. */
        <Card className="mb-6 border-info/30 bg-info-wash px-4 py-3.5">
          <p className="text-[var(--text-body)] font-medium text-info">
            Briefing partiel : {briefing.droitsManquants.join(", ")}.
          </p>
          <p className="mt-1 text-[var(--text-secondary)] text-info">
            Votre rôle n&apos;ouvre pas ces données. Les recommandations correspondantes
            sont absentes — pas nulles, absentes. Un administrateur peut vous accorder
            le droit manquant.
          </p>
        </Card>
      )}

      {board.failed && (
        <Card className="mb-6 border-warning/30 bg-warning-wash px-4 py-3.5">
          <p className="text-[var(--text-body)] font-medium text-warning">
            {board.failureReason}
          </p>
          <p className="mt-1 text-[var(--text-secondary)] text-warning">
            Ce n&apos;est pas « aucune décision » : la liste n&apos;a pas pu être lue.
          </p>
        </Card>
      )}

      {!canAct && !board.failed && board.items.length > 0 && (
        <Card className="mb-6 border-info/30 bg-info-wash px-4 py-3.5">
          <p className="text-[var(--text-body)] text-info">
            Vous consultez les décisions sans pouvoir y répondre : cela demande le droit
            de conduire les chantiers. Les explications, elles, restent utiles.
          </p>
        </Card>
      )}

      {/* ---- Ce qui vient d'une conversation ----
          Ces demandes n'ont pas de décision derrière elles : elles
          naissent d'une phrase tapée dans un fil. Sans ce bloc, fermer
          l'onglet entre la question et le clic les rendait invisibles,
          et elles mouraient d'expiration au bout de vingt-quatre
          heures. */}
      {conversationApprovals.length > 0 && (
        <Panel
          title="Demandes venues d'une conversation"
          description="Préparées par Oasis, jamais exécutées. Elles expirent au bout de vingt-quatre heures."
          count={conversationApprovals.length}
          className="mb-6"
        >
          <ul className="divide-y divide-line">
            {conversationApprovals.map((approval) => (
              <LigneApprobation
                key={approval.approvalId}
                approval={approval}
                label={index.get(approval.actionType)?.label ?? approval.actionType}
                canAct={canAct}
              />
            ))}
          </ul>
        </Panel>
      )}

      {/* ---- Les décisions : ce qui a des boutons ---- */}
      {(board.items.length > 0 || categorie !== undefined) && (
        <section aria-labelledby="titre-decisions" className="mb-10">
          <h2
            id="titre-decisions"
            className="mb-3 text-[length:var(--text-section)] font-semibold tracking-tight"
          >
            À décider
          </h2>

          {/* LE FILTRE MONTRE CE QU'IL CACHE. Les compteurs portent sur
              TOUTES les décisions ouvertes, pas sur celles que le filtre
              courant laisse voir : un filtre qui masque sans dire
              combien il masque fait rater ce qui compte. Il n'apparaît
              que s'il y a de quoi filtrer — sur un compte neuf, cinq
              pastilles à zéro seraient du décor. */}
          {(board.openTotal > 0 || categorie !== undefined) && (
            <nav className="mb-4 flex flex-wrap gap-1.5" aria-label="Catégories">
              <FilterChip
                href={lienCategorie(null, toutVoir)}
                label="Toutes"
                count={board.openTotal}
                active={categorie === undefined}
              />
              {DECISION_CATEGORIES.map((cle) => (
                <FilterChip
                  key={cle}
                  href={lienCategorie(cle, toutVoir)}
                  label={CATEGORY_LABELS[cle]}
                  count={board.openByCategory[cle]}
                  active={categorie === cle}
                />
              ))}
            </nav>
          )}

          {board.items.length === 0 && !board.failed ? (
            <EmptyState
              title={
                categorie
                  ? `Aucune décision « ${CATEGORY_LABELS[categorie].toLowerCase()} » ouverte.`
                  : "Aucune décision en attente."
              }
              description={
                board.openTotal > 0
                  ? "D'autres catégories en contiennent — les compteurs ci-dessus disent lesquelles."
                  : "Lancez l'analyse : Oasis relit vos chantiers, vos devis et vos factures, et n'ouvre une décision que s'il a de quoi la justifier."
              }
            />
          ) : (
            <div className="flex flex-col gap-4">
              {board.items.map((item) => (
                <DecisionCard
                  key={item.decision.id}
                  item={item}
                  catalog={index}
                  canAct={canAct}
                  confirmMessages={confirmMessages}
                  monAvis={mesAvis.get(item.decision.id) ?? null}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {/* ---- Les constats qui n'ont pas encore de boutons ----
          Masqués quand un filtre de catégorie est actif : la liste se
          construit en retirant les titres DÉJÀ portés par une décision,
          et le filtre vient justement d'en cacher une partie. Elle
           ferait donc réapparaître, comme « sans décision », des lignes
           qui en ont une ailleurs. */}
      {categorie === undefined && rubriques.length > 0 && (
        <section aria-labelledby="titre-constats" className="mb-10">
          <h2
            id="titre-constats"
            className="mb-1 text-[length:var(--text-section)] font-semibold tracking-tight"
          >
            {board.items.length > 0 ? "Également repéré" : "Ce qu'Oasis a repéré"}
          </h2>
          {/* La phrase qui remplace l'ancien renvoi vers l'autre onglet.
              Le bouton est en haut de CETTE page, plus dans un écran
              voisin : il n'y a plus de voyage à faire. */}
          <p className="mb-3 text-[var(--text-secondary)] text-ink-soft">
            Lus à l&apos;instant, sans décision ouverte. « Lancer
            l&apos;analyse » leur donne leurs boutons.
          </p>
          <div className="flex flex-col gap-4">
            {rubriques.map((rubrique) => (
              <Panel
                key={rubrique.code}
                title={libelleRubrique(rubrique.code)}
                count={rubrique.elements.length}
              >
                <ul className="divide-y divide-line">
                  {rubrique.elements.map((element, position) => (
                    <LigneConstat
                      key={`${rubrique.code}-${position}`}
                      item={element}
                      tone={rubricTone(rubrique.code)}
                    />
                  ))}
                </ul>
              </Panel>
            ))}
          </div>
        </section>
      )}

      {/* ---- Le vrai vide : quand rien n'est lisible nulle part ---- */}
      {totalementVide && (
        <EmptyState
          title="Oasis n'a encore rien à vous dire."
          description="Il relit vos chantiers, vos devis et vos factures, et n'ouvre une décision que s'il a de quoi la justifier. Aucun fait daté n'est en attente non plus : c'est une vraie matinée calme, pas une panne."
          action={
            <form action={runExecutiveScan}>
              <SubmitButton>Lancer l&apos;analyse</SubmitButton>
            </form>
          }
        />
      )}

      {/* ---- Les faits du jour, sous les recommandations ---- */}
      <DetailDuJour priorities={priorities} />

      {/* ---- Le champ de question, ancré en bas ---- */}
      <section aria-labelledby="titre-question" className="mt-10 border-t border-line pt-6">
        <h2 id="titre-question" className="mb-2 text-[var(--text-body)] font-medium">
          Une question sur vos données ?
        </h2>
        <Composeur variante="accueil" />
      </section>

      {/* ---- LE PIED DE PAGE, UNE SEULE FOIS ----
          Il apparaissait trois fois dans l'espace, et le compteur de
          questions deux fois. */}
      <p className="mt-8 text-[11px] text-ink-faint">
        {usage?.used ? `${usage.used} question(s) posées à Oasis ce mois-ci. ` : ""}
        Les montants viennent de vos données, mais relisez-les avant de vous engager
        dessus. Chaque écriture d&apos;Oasis est signée, avec l&apos;agent, votre nom et
        l&apos;heure, dans{" "}
        <Link href="/oasis-ai/reglages#journal" className="text-accent hover:underline">
          le journal des réglages
        </Link>
        .{" "}
        {toutVoir ? (
          <Link
            href={lienCategorie(categorie ?? null, false)}
            className="text-accent hover:underline"
          >
            Ne montrer que les décisions ouvertes
          </Link>
        ) : (
          <Link
            href={lienCategorie(categorie ?? null, true)}
            className="text-accent hover:underline"
          >
            Voir aussi les décisions déjà tranchées
          </Link>
        )}
      </p>
    </div>
  );
}

/**
 * L'URL du filtre, les deux réglages conservés.
 *
 * Le filtre et « voir aussi les décisions tranchées » sont deux axes
 * indépendants ; cliquer l'un ne doit pas réinitialiser l'autre en
 * silence. C'est aussi ce qui rend l'adresse partageable : ce que l'on
 * envoie à un collègue est exactement ce que l'on voit.
 */
function lienCategorie(categorie: DecisionCategory | null, toutVoir: boolean): string {
  const parametres = new URLSearchParams();
  if (categorie) parametres.set("categorie", categorie);
  if (toutVoir) parametres.set("tout", "1");
  const suffixe = parametres.toString();
  return suffixe ? `/oasis-ai?${suffixe}` : "/oasis-ai";
}

function FilterChip({
  href,
  label,
  count,
  active,
}: {
  href: string;
  label: string;
  count: number;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={`inline-flex items-center gap-1.5 rounded-[var(--radius-pill)] border px-3 py-1.5 text-[var(--text-secondary)] transition-colors ${
        active
          ? "border-accent bg-accent-wash font-medium text-accent"
          : "border-line-strong bg-surface text-ink-soft hover:bg-canvas hover:text-ink"
      }`}
    >
      {label}
      {/* Un zéro s'affiche quand même sur un filtre : c'est là qu'il
          veut dire quelque chose — « inutile de cliquer ». */}
      <span className="tabular text-ink-faint">{count}</span>
    </Link>
  );
}

function rubricTone(code: string): Tone {
  switch (code) {
    case "URGENT":
      return "critical";
    case "COMMERCIAL":
      return "accent";
    case "FINANCE":
      return "warning";
    case "PLANNING":
      return "info";
    default:
      return "neutral";
  }
}

const TEINTE_FILET: Record<Tone, string> = {
  critical: "bg-critical",
  accent: "bg-accent",
  warning: "bg-warning",
  info: "bg-info",
  positive: "bg-positive",
  neutral: "bg-line-strong",
};

/**
 * Un constat, et son explication repliée.
 *
 * `<details>` natif plutôt qu'un état React : la page reste un composant
 * serveur, l'ouverture marche sans JavaScript, la recherche du
 * navigateur (Ctrl+F) trouve le texte replié, et le clavier fonctionne
 * sans qu'on ait rien à écrire. Le « Pourquoi ? » n'est jamais à un
 * chargement de distance.
 *
 * LA COULEUR NE PORTE JAMAIS SEULE L'INFORMATION : le filet de gauche
 * double l'intertitre de la rubrique, qui est écrit en toutes lettres
 * juste au-dessus. Un lecteur d'écran, ou un œil qui ne distingue pas
 * l'ambre du rouge, lit le même classement.
 */
function LigneConstat({ item, tone }: { item: BriefItem; tone: Tone }) {
  return (
    <li className="flex gap-3 px-5 py-3.5">
      <span aria-hidden="true" className={`w-0.5 shrink-0 rounded-full ${TEINTE_FILET[tone]}`} />
      <details className="group min-w-0 flex-1">
        <summary className="flex cursor-pointer list-none flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="min-w-0 flex-1 text-[var(--text-body)] font-medium">
            {item.titre}
          </span>
          {/* Un tiret, jamais « 0 € » : « on ne sait pas chiffrer » et
              « ça ne vaut rien » ne se lisent pas pareil. */}
          <span
            className={`tabular shrink-0 text-[var(--text-body)] font-medium ${
              item.impactCents === null ? "text-ink-faint" : ""
            }`}
          >
            {formatCents(item.impactCents)}
          </span>
          <span className="shrink-0 text-[var(--text-secondary)] text-accent group-open:hidden">
            Pourquoi ?
          </span>
          <span className="hidden shrink-0 text-[var(--text-secondary)] text-ink-faint group-open:inline">
            Replier
          </span>
        </summary>

        <div className="mt-3 rounded-[var(--radius-control)] bg-surface-sunken px-4 py-3.5">
          <Explanation
            pourquoi={item.pourquoi}
            impactCents={item.impactCents}
            impactTexte={item.impactTexte}
            donneesUtilisees={item.donneesUtilisees}
            confiance={item.confiance}
            siRienNestFait={item.siRienNestFait}
            actionRecommandee={item.actionRecommandee}
          />
        </div>
      </details>
    </li>
  );
}

/**
 * Une demande née d'une conversation.
 *
 * Le formulaire ne porte QUE l'identifiant de l'approbation :
 * `answerApproval` relit l'action et son type sur la ligne, et
 * n'exécute que si `ai_answer_approval` a bien fait passer l'action à
 * « approuvée ».
 */
function LigneApprobation({
  approval,
  label,
  canAct,
}: {
  approval: OrphanApproval;
  label: string;
  canAct: boolean;
}) {
  const parameters = (approval.parameters ?? {}) as Record<string, unknown>;
  const dossier = typeof parameters.libelle === "string" ? parameters.libelle : null;
  const client = typeof parameters.client === "string" ? parameters.client : null;
  const montant =
    typeof parameters.montantHtCents === "number" ? parameters.montantHtCents : null;

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={RISK_TONES[approval.risk]}>{RISK_LABELS[approval.risk]}</Badge>
          <p className="text-[var(--text-body)] font-medium">{label}</p>
        </div>
        <p className="mt-0.5 text-[var(--text-secondary)] text-ink-soft">
          {dossier ?? "Dossier non nommé"}
          {client ? ` — ${client}` : ""}
          {montant === null ? " — montant inconnu" : ` — ${formatCents(montant)} HT`}
        </p>
        <p className="mt-0.5 text-[11px] text-ink-faint">
          Expire le{" "}
          {new Date(approval.expiresAt).toLocaleString("fr-FR", {
            day: "numeric",
            month: "long",
            hour: "2-digit",
            minute: "2-digit",
          })}
          .
        </p>
      </div>
      {canAct ? (
        <div className="flex flex-wrap gap-2">
          <form action={answerApproval}>
            <input type="hidden" name="approvalId" value={approval.approvalId} />
            <input type="hidden" name="ok" value="1" />
            <SubmitButton>Valider et exécuter</SubmitButton>
          </form>
          <form action={answerApproval}>
            <input type="hidden" name="approvalId" value={approval.approvalId} />
            <input type="hidden" name="ok" value="0" />
            <SubmitButton variant="secondary">Refuser</SubmitButton>
          </form>
        </div>
      ) : (
        <p className="text-[var(--text-secondary)] text-ink-faint">
          Votre rôle ne permet pas de répondre à une validation.
        </p>
      )}
    </li>
  );
}

function compterFaits(priorities: DailyPriorities): number {
  return (
    priorities.interventionsDuJour.length +
    priorities.devisARelancer.length +
    priorities.devisQuiExpirent.length +
    priorities.facturesEnRetard.length +
    priorities.chantiersEnRetard.length +
    priorities.receptionsAttendues.length +
    ((priorities.pointagesAValider.nombre ?? 0) > 0 ? 1 : 0)
  );
}

/**
 * Les sept listes de faits datés. Elles viennent de la MÊME réponse que
 * le briefing (`sources.prioritesDuJour`), donc elles ne peuvent pas le
 * contredire.
 *
 * Elles restent SOUS les recommandations : le briefing dit ce qu'il faut
 * faire, le détail dit sur quoi. Un écran qui commence par une liste
 * d'interventions oblige à conclure soi-même.
 */
function DetailDuJour({ priorities }: { priorities: DailyPriorities }) {
  const pending = priorities.pointagesAValider;

  if (priorities.failed) {
    return (
      <Card className="border-warning/30 bg-warning-wash px-4 py-3.5">
        <p className="text-[var(--text-body)] font-medium text-warning">
          Le détail du jour n&apos;a pas pu être établi.
        </p>
        <p className="mt-1 text-[var(--text-secondary)] text-warning">
          Vos interventions et vos factures restent consultables depuis leurs écrans.
        </p>
      </Card>
    );
  }

  if (compterFaits(priorities) === 0) return null;

  return (
    <section aria-labelledby="titre-detail">
      <h2
        id="titre-detail"
        className="mb-3 text-[length:var(--text-section)] font-semibold tracking-tight"
      >
        Le détail du jour
      </h2>
      <div className="flex flex-col gap-3">
        <BlocDuJour
          title="Interventions du jour"
          count={priorities.interventionsDuJour.length}
          href="/planning"
        >
          {priorities.interventionsDuJour.map((item, index) => (
            <Ligne
              key={index}
              main={item.titre}
              detail={[
                item.client,
                new Date(item.debut).toLocaleTimeString("fr-FR", {
                  hour: "2-digit",
                  minute: "2-digit",
                }),
              ]
                .filter(Boolean)
                .join(" · ")}
            />
          ))}
        </BlocDuJour>

        <BlocDuJour
          title="Factures en retard"
          count={priorities.facturesEnRetard.length}
          tone="critical"
          href="/factures"
        >
          {priorities.facturesEnRetard.map((item, index) => (
            <Ligne
              key={index}
              main={`${item.numero} — ${item.client ?? "client inconnu"}`}
              detail={`Échue le ${formatDate(item.echeance)}`}
              amount={formatCents(item.resteADevoir)}
            />
          ))}
        </BlocDuJour>

        <BlocDuJour
          title="Devis à relancer"
          count={priorities.devisARelancer.length}
          tone="warning"
          href="/devis"
        >
          {priorities.devisARelancer.map((item, index) => (
            <Ligne
              key={index}
              main={`${item.numero} — ${item.titre}`}
              detail={`Envoyé le ${formatDate(item.envoyeLe)}, sans réponse`}
            />
          ))}
        </BlocDuJour>

        <BlocDuJour
          title="Devis qui expirent"
          count={priorities.devisQuiExpirent.length}
          tone="warning"
          href="/devis"
        >
          {priorities.devisQuiExpirent.map((item, index) => (
            <Ligne
              key={index}
              main={item.numero}
              detail={`Valable jusqu'au ${formatDate(item.valableJusquAu)}`}
            />
          ))}
        </BlocDuJour>

        <BlocDuJour
          title="Chantiers en retard"
          count={priorities.chantiersEnRetard.length}
          tone="warning"
          href="/projets"
        >
          {priorities.chantiersEnRetard.map((item, index) => (
            <Ligne
              key={index}
              main={`${item.numero} — ${item.nom}`}
              detail={`Fin prévue le ${formatDate(item.finPrevue)}`}
            />
          ))}
        </BlocDuJour>

        <BlocDuJour
          title="Réceptions attendues"
          count={priorities.receptionsAttendues.length}
          href="/achats"
        >
          {priorities.receptionsAttendues.map((item, index) => (
            <Ligne
              key={index}
              main={item.commande}
              detail={`Attendue le ${formatDate(item.attendueLe)}`}
            />
          ))}
        </BlocDuJour>

        {(pending.nombre ?? 0) > 0 && (
          <Card className="flex flex-wrap items-center gap-3 px-4 py-3">
            <Badge tone="warning">Pointages</Badge>
            <p className="min-w-0 flex-1 text-[var(--text-body)]">
              {/* UN TIRET, JAMAIS « 0 h ». Ce champ est optionnel : une
                  lecture d'heures qui a échoué affichait
                  « 0 h pointées attendent une validation » — un zéro
                  rassurant au milieu de la phrase qui explique
                  justement que la marge est incomplète. C'est le motif
                  que ce projet a déjà corrigé trois fois. */}
              {pending.heures === undefined ? (
                <>
                  <strong>{pending.nombre}</strong> pointage(s) attendent une validation ;
                  leur total d&apos;heures n&apos;a pas pu être lu.
                </>
              ) : (
                <>
                  <strong className="tabular">{pending.heures} h</strong> pointées attendent
                  une validation.
                </>
              )}{" "}
              Tant qu&apos;elles ne sont pas validées, elles n&apos;entrent dans aucun
              budget de chantier — et la marge affichée est incomplète.
            </p>
            <Link
              href="/projets/interventions"
              className="text-[var(--text-body)] text-accent hover:underline"
            >
              Valider
            </Link>
          </Card>
        )}
      </div>
    </section>
  );
}

function BlocDuJour({
  title,
  count,
  children,
  tone,
  href,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
  tone?: Tone;
  href?: string;
}) {
  // Un bloc vide ne s'affiche pas : une liste de titres suivis de
  // « aucun » remplit l'écran sans rien dire.
  if (count === 0) return null;

  return (
    <Card>
      <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <h3 className="flex-1 text-[var(--text-body)] font-medium">{title}</h3>
        <Badge tone={tone ?? "neutral"}>{count}</Badge>
        {href && (
          <Link href={href} className="text-[var(--text-secondary)] text-accent hover:underline">
            Ouvrir
          </Link>
        )}
      </div>
      <ul className="divide-y divide-line">{children}</ul>
    </Card>
  );
}

function Ligne({ main, detail, amount }: { main: string; detail?: string; amount?: string }) {
  return (
    <li className="flex items-center gap-3 px-4 py-2.5">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[var(--text-body)]">{main}</span>
        {detail && (
          <span className="block truncate text-[var(--text-secondary)] text-ink-soft">
            {detail}
          </span>
        )}
      </span>
      {amount && (
        <span className="tabular shrink-0 text-[var(--text-body)] font-medium">{amount}</span>
      )}
    </li>
  );
}

export const dynamic = "force-dynamic";
