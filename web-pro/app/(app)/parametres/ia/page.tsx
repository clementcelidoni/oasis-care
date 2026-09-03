import { Suspense } from "react";
import Link from "next/link";
import { requireOrganization } from "@/lib/auth/organization";
import { Card, PageHeader, Badge } from "@/components/ui";
import { lireCarteAgents } from "@/lib/ai/admin/lecture";
import { IaTabs } from "./IaTabs";
import { CarteAgents } from "./CarteAgents";
import { Disponibilite, DisponibiliteSquelette } from "./Disponibilite";

/**
 * §11V — « AI CONFIGURATION » (spec p. 26), DANS L'ADMINISTRATION
 * TECHNIQUE.
 *
 * ══════════════════════════════════════════════════════════════════
 * POURQUOI CETTE PAGE EST FERMÉE AUX NON-ADMINISTRATEURS, ALORS QUE
 * LE RESTE DES PARAMÈTRES NE L'EST PAS
 * ══════════════════════════════════════════════════════════════════
 *
 * Partout ailleurs dans §42, la règle est : on n'escamote pas l'écran,
 * on retire de quoi écrire et on dit pourquoi. Un salarié a le droit de
 * savoir comment son entreprise est réglée.
 *
 * Ici, non — et c'est la page 27 qui l'impose : « L'utilisateur final
 * ne voit PAS "GPT-5.6 Terra" partout. Il voit simplement : Oasis AI. »
 * Cette page AFFICHE les identifiants de modèle ; c'est même sa raison
 * d'être, puisque c'est le seul endroit où l'on peut apprendre qu'un nom
 * est faux. Laisser un conducteur de travaux la consulter en lecture
 * seule ferait exactement ce que la page 27 interdit.
 *
 * Le refus est donc total, et il ne laisse filtrer aucun identifiant —
 * pas même dans un message d'erreur.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE QUE CETTE PAGE NE PRÉTEND PAS
 * ══════════════════════════════════════════════════════════════════
 *
 * Elle n'annonce PAS qu'un modèle a réellement répondu. Une dérogation
 * prend effet au prochain appel — `runtimeAgents()`
 * (lib/ai/runtime/supabase.ts) relit `ai_model_overrides` à chaque
 * requête et décore le routeur avec `appliquerSurcharges` — mais
 * « aiguillé vers » n'est pas « a répondu ». Les faits d'usage
 * — a-t-on appelé ce modèle, combien de fois, pour combien — se lisent
 * sur l'onglet des coûts, qui les tient du grand livre et non d'une
 * promesse. Et le contrôle de disponibilité, plus bas, est le seul
 * endroit qui dise si l'identifiant existe vraiment chez le
 * fournisseur.
 */
export default async function ConfigurationIAPage() {
  const organization = await requireOrganization();
  const peutModifier = organization.permissions.includes("organization.manageUsers");

  if (!peutModifier) {
    return (
      <div className="mx-auto max-w-4xl px-8 py-10">
        <PageHeader
          eyebrow="Administration technique"
          title="Configuration IA"
          subtitle="Le réglage interne du moteur d'Oasis AI."
        />
        <Card className="border-info/30 bg-info-wash px-5 py-4">
          <p className="text-[var(--text-body)] font-medium text-info">
            Cet écran est réservé aux administrateurs de l&apos;entreprise.
          </p>
          <p className="mt-1 text-[var(--text-body)] text-info">
            Il ne s&apos;agit pas d&apos;un réglage que vous pourriez consulter sans y toucher :
            il expose le détail technique du moteur, et ce détail n&apos;a pas à circuler.
            Côté usage, Oasis AI s&apos;utilise sans rien savoir de tout cela — c&apos;est
            précisément ce qu&apos;on lui demande.
          </p>
          <p className="mt-3 text-[var(--text-secondary)] text-info">
            <Link href="/oasis-ai" className="underline">
              Retourner à Oasis AI
            </Link>
          </p>
        </Card>
      </div>
    );
  }

  const carte = await lireCarteAgents(organization.organizationId);

  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      <PageHeader
        eyebrow="Administration technique"
        title="Configuration IA"
        subtitle="Quel modèle chaque agent demande, et si ces modèles existent vraiment."
        action={<Badge tone="accent">Administrateur</Badge>}
      />

      <IaTabs current="/parametres/ia" />

      {/* §11V p. 27 — la règle, écrite là où elle est enfreinte, pour que
          personne ne recopie ce vocabulaire ailleurs par imitation. */}
      <Card className="mb-6 px-5 py-4">
        <p className="text-[var(--text-body)] text-ink-soft">
          <span className="font-medium text-ink">
            C&apos;est la seule page du produit où un nom de modèle s&apos;écrit.
          </span>{" "}
          Partout ailleurs — briefing du matin, centre de décision, conversation — vos équipes
          lisent « Oasis AI » et rien d&apos;autre : le choix du moteur est une affaire interne,
          et l&apos;afficher n&apos;aiderait personne à trancher un devis.
        </p>
      </Card>

      {/* La lecture des dérogations peut échouer sans que l'aiguillage,
          lui, soit inconnu : il vient du code. On le dit sur la seule
          colonne concernée plutôt que de vider la page. */}
      {carte.etat !== "lue" && (
        <Card
          className={`mb-6 px-5 py-4 ${
            carte.etat === "absente" ? "border-info/30 bg-info-wash" : "border-warning/30 bg-warning-wash"
          }`}
        >
          <p
            className={`text-[var(--text-body)] ${
              carte.etat === "absente" ? "text-info" : "text-warning"
            }`}
          >
            {carte.message}
          </p>
          <p
            className={`mt-1 text-[var(--text-secondary)] ${
              carte.etat === "absente" ? "text-info" : "text-warning"
            }`}
          >
            L&apos;aiguillage ci-dessous reste exact — il vient de la configuration du produit,
            pas de la base. Seules les dérogations propres à cette entreprise sont inconnues,
            et aucune ne peut être enregistrée pour l&apos;instant.
          </p>
        </Card>
      )}

      <Suspense fallback={<DisponibiliteSquelette />}>
        <Disponibilite />
      </Suspense>

      <CarteAgents carte={carte.donnees} peutModifier={peutModifier && carte.etat === "lue"} />

      <p className="text-[11px] text-ink-faint">
        Les dépenses, le ratio d&apos;usage des trois niveaux et les plafonds se règlent dans{" "}
        <Link href="/parametres/ia/couts" className="text-accent hover:underline">
          Coûts et plafonds
        </Link>
        . Les retours 👍 / 👎 de vos équipes s&apos;y lisent aussi : c&apos;est la seule mesure
        de qualité qu&apos;aucun compteur ne remplace.
      </p>
    </div>
  );
}
