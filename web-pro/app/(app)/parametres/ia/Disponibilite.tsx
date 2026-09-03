import { Card, StatusBadge, Skeleton } from "@/components/ui";
import { verifierDisponibiliteModeles, type EtatModele } from "@/lib/ai/model/availability";
import { LIBELLES_NIVEAU } from "@/lib/ai/admin";

/**
 * §11V — LE CONTRÔLE DE DISPONIBILITÉ DES TROIS IDENTIFIANTS.
 *
 * ══════════════════════════════════════════════════════════════════
 * C'EST ICI, ET NULLE PART AILLEURS, QU'ON APPREND QU'UN NOM EST FAUX
 * ══════════════════════════════════════════════════════════════════
 *
 * Le dépôt appelait « gpt-5.6 » tout court à quinze endroits ; les trois
 * déclinaisons `-sol`, `-terra`, `-luna` de la page 2 n'ont jamais pu
 * être vérifiées contre l'API. Sans ce panneau, un nom faux se
 * découvrirait un matin, au milieu d'un appel d'agent, sous la forme
 * d'une erreur qui ne dit pas que le problème est un nom de modèle.
 *
 * ══════════════════════════════════════════════════════════════════
 * POURQUOI LA VÉRIFICATION EST AUTOMATIQUE, ET POURQUOI ELLE STREAM
 * ══════════════════════════════════════════════════════════════════
 *
 * Automatique : derrière un bouton, elle resterait non cliquée, et un
 * nom faux non découvert. La consigne est explicite — « c'est ici que
 * l'utilisateur apprendra qu'un nom est erroné, et pas autrement ».
 *
 * En `Suspense` : trois appels HTTP, six secondes au pire. La page
 * s'affiche immédiatement et ce panneau arrive ensuite. Sans cela, la
 * carte des agents — qui, elle, ne dépend d'aucun réseau — attendrait
 * une API tierce pour s'afficher.
 *
 * Sans clé serveur, `verifierDisponibiliteModeles` n'ouvre AUCUNE
 * connexion et rend trois « non vérifiable ». C'est l'état du produit
 * aujourd'hui, et il ne doit pas ressembler à une panne.
 */

const TEINTES: Record<EtatModele, "positive" | "critical" | "neutral"> = {
  disponible: "positive",
  // « Introuvable » est un CONSTAT, pas une panne : le nom est faux, ou
  // le compte n'a pas accès à ce modèle. Dans les deux cas il faut agir,
  // d'où la teinte d'alerte.
  introuvable: "critical",
  // Ni oui ni non. Surtout pas une alerte : envoyer quelqu'un corriger
  // un nom parfaitement correct parce que la clé manque serait le seul
  // vrai échec de ce panneau.
  non_verifiable: "neutral",
};

const MOTS: Record<EtatModele, string> = {
  disponible: "Confirmé",
  introuvable: "Introuvable",
  non_verifiable: "Non vérifié",
};

export function DisponibiliteSquelette() {
  return (
    <Card className="mb-6">
      <div className="border-b border-line px-5 py-3.5">
        <h2 className="text-[length:var(--text-card)] font-semibold leading-tight">
          Les trois identifiants de modèle
        </h2>
        <p className="mt-0.5 text-[var(--text-secondary)] text-ink-soft">
          Vérification en cours auprès de l&apos;API…
        </p>
      </div>
      <div className="flex flex-col gap-3 px-5 py-5">
        <Skeleton className="h-5 w-full" />
        <Skeleton className="h-5 w-full" />
        <Skeleton className="h-5 w-2/3" />
      </div>
    </Card>
  );
}

export async function Disponibilite() {
  const rapport = await verifierDisponibiliteModeles();

  const resume = !rapport.cleConfiguree
    ? "Aucune clé OpenAI n'est configurée côté serveur : les identifiants n'ont pas pu être confrontés à l'API."
    : rapport.tousDisponibles
      ? "L'API confirme les trois identifiants."
      : rapport.auMoinsUnIntrouvable
        ? "Au moins un identifiant est introuvable. Tant qu'il n'est pas corrigé, les appels qui l'utilisent échoueront."
        : "La vérification n'a pas abouti. Ce n'est pas un constat d'absence : réessayez plus tard.";

  return (
    <Card
      className={`mb-6 ${rapport.auMoinsUnIntrouvable ? "border-critical/30" : ""}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-3.5">
        <div className="min-w-0">
          <h2 className="text-[length:var(--text-card)] font-semibold leading-tight">
            Les trois identifiants de modèle
          </h2>
          <p className="mt-0.5 text-[var(--text-secondary)] text-ink-soft">{resume}</p>
        </div>
        <StatusBadge
          tone={
            rapport.auMoinsUnIntrouvable
              ? "critical"
              : rapport.tousDisponibles
                ? "positive"
                : "neutral"
          }
        >
          {rapport.auMoinsUnIntrouvable
            ? "À corriger"
            : rapport.tousDisponibles
              ? "Tout confirmé"
              : "Non vérifié"}
        </StatusBadge>
      </div>

      <ul className="divide-y divide-line">
        {rapport.modeles.map((modele) => (
          <li key={modele.niveau} className="px-5 py-3.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[var(--text-body)] font-medium">
                {LIBELLES_NIVEAU[modele.niveau]}
              </span>
              {/* L'identifiant en toutes lettres : c'est la seule page du
                  produit qui a le droit de l'écrire (p. 27), et c'est
                  précisément l'information qu'on vient chercher ici. */}
              <code className="rounded bg-surface-sunken px-1.5 py-0.5 text-[12px] text-ink-soft">
                {modele.modele}
              </code>
              <StatusBadge tone={TEINTES[modele.etat]}>{MOTS[modele.etat]}</StatusBadge>
            </div>
            <p className="mt-1 text-[var(--text-secondary)] text-ink-soft">{modele.detail}</p>
            {modele.etat === "introuvable" && (
              <p className="mt-1 text-[var(--text-secondary)] text-critical">
                Corrigez-le sans redéployer, avec la variable d&apos;environnement{" "}
                <code className="rounded bg-critical-wash px-1 py-0.5 text-[11px]">
                  {modele.variableDeCorrection}
                </code>
                .
              </p>
            )}
          </li>
        ))}
      </ul>

      <p className="border-t border-line px-5 py-3.5 text-[var(--text-secondary)] text-ink-soft">
        Vérifié le{" "}
        {new Date(rapport.verifieLe).toLocaleString("fr-FR", {
          day: "numeric",
          month: "long",
          hour: "2-digit",
          minute: "2-digit",
        })}
        , à chaque affichage de cette page. « Non vérifié » n&apos;est pas
        « indisponible » : c&apos;est l&apos;absence de réponse — clé manquante,
        quota dépassé, réseau coupé — et cela ne dit rien du nom lui-même.
      </p>
    </Card>
  );
}
