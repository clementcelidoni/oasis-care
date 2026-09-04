import { Badge, StatusBadge, TechnicalId, UnknownValue, type Tone } from "@/components/ui";
import { formatCents, formatDateTime, shortId } from "@/lib/format";
import type { EtatModele } from "@/lib/ia/disponibilite";
import { LIBELLES_NIVEAU, type Niveau } from "@/lib/ia/modeles";
import { etatPlafond } from "@/lib/ia/montants";

/**
 * ==================================================================
 * LES PETITES PIÈCES D'AFFICHAGE DES ÉCRANS IA
 * ==================================================================
 *
 * Elles existent pour une raison unique : chacune porte une DISTINCTION
 * qu'un rendu improvisé effacerait. Un niveau n'est pas un identifiant,
 * « aucun plafond » n'est pas « IA coupée », « introuvable » n'est pas
 * « non vérifiable ». Trois confusions, trois composants — et un seul
 * endroit à corriger le jour où le vocabulaire évolue.
 */

/**
 * Un niveau, avec son nom français.
 *
 * La couleur suit le COÛT, pas l'humeur : l'avancé est le plus cher,
 * donc il porte le ton d'avertissement. Ce n'est pas un jugement sur la
 * qualité — c'est le meilleur modèle — mais l'écran sert à surveiller
 * une facture, et un agent passé en avancé doit se voir dans une
 * colonne de quatorze lignes.
 */
const TON_NIVEAU: Record<Niveau, Tone> = {
  economy: "positive",
  standard: "info",
  advanced: "warning",
};

export function NiveauBadge({ niveau }: { niveau: Niveau }) {
  return <Badge tone={TON_NIVEAU[niveau]}>{LIBELLES_NIVEAU[niveau]}</Badge>;
}

/**
 * Un identifiant de modèle.
 *
 * En monospace, et jamais présenté comme un niveau. C'est aussi la
 * donnée que la spec « Architecture IA » p.27 interdit de montrer à un
 * utilisateur final — ici, on est chez l'éditeur, et c'est précisément
 * l'endroit où elle doit être lisible.
 */
export function IdentifiantModele({ modele }: { modele: string }) {
  return (
    <code className="rounded bg-surface-sunken px-1.5 py-0.5 font-mono text-[11px] text-ink-soft">
      {modele}
    </code>
  );
}

/**
 * Un plafond, dans ses TROIS états.
 *
 * `null` → « Aucun plafond », `0` → « IA coupée », sinon le montant.
 * C'est la règle des migrations 0076 et 0080, et le composant existe
 * pour qu'aucun écran ne puisse la contourner par distraction : un
 * tiret pour l'un et « 0 € » pour l'autre inviterait à les lire comme
 * la même chose, alors qu'ils sont opposés — l'un ne borne rien, l'autre
 * éteint tout.
 */
export function Plafond({ cents }: { cents: number | null | undefined }) {
  const etat = etatPlafond(cents);

  if (etat.etat === "aucun") {
    return (
      <UnknownValue
        label="Aucun plafond"
        inline
        reason="Aucune limite n'est posée : la dépense de cette entreprise n'est bornée par rien."
      />
    );
  }

  if (etat.etat === "coupee") {
    return <StatusBadge tone="critical">IA coupée (0 €)</StatusBadge>;
  }

  return <span className="tabular font-medium text-ink">{formatCents(etat.cents, { decimals: true })}</span>;
}

/**
 * L'état d'un identifiant face à l'API.
 *
 * « Introuvable » et « non vérifiable » ne partagent pas de ton :
 * confondre les deux enverrait quelqu'un corriger un nom de modèle
 * parfaitement correct parce que la clé manque.
 */
export function EtatDisponibilite({ etat }: { etat: EtatModele }) {
  if (etat === "disponible") return <StatusBadge tone="positive">Confirmé par l&apos;API</StatusBadge>;
  if (etat === "introuvable") return <StatusBadge tone="critical">Introuvable (404)</StatusBadge>;
  return <StatusBadge tone="unknown">Non vérifiable</StatusBadge>;
}

/**
 * Qui a écrit, et quand.
 *
 * L'adresse quand on a pu la résoudre, l'identifiant tronqué sinon —
 * jamais « inconnu » tout court : un uuid reste une information, et
 * c'est celle qu'on recopie dans une requête pour aller plus loin.
 *
 * `null` en revanche veut vraiment dire qu'on ne sait pas : la colonne
 * `updated_by` accepte le nul, et une ligne posée AVANT la migration
 * 0080 pouvait l'être par n'importe quel gestionnaire d'entreprise
 * cliente. C'est exactement ce que 0080 a fermé, et le dire ainsi
 * raconte l'histoire au lieu de la masquer.
 */
export function Auteur({
  identifiant,
  quand,
  noms,
}: {
  identifiant: string | null;
  quand: string | null;
  noms: Map<string, string>;
}) {
  const date = formatDateTime(quand);

  if (identifiant === null) {
    return (
      <span className="text-[var(--text-secondary)] text-ink-soft">
        <UnknownValue
          label="Auteur inconnu"
          inline
          reason="La colonne updated_by est nulle. Une ligne écrite avant la migration 0080 pouvait l'être par le gestionnaire de l'entreprise cliente elle-même — c'est précisément ce que 0080 a fermé."
        />
        {date !== null && <span className="ml-2 tabular text-ink-faint">{date}</span>}
      </span>
    );
  }

  const nom = noms.get(identifiant) ?? null;

  return (
    <span className="text-[var(--text-secondary)] text-ink-soft">
      {nom !== null ? nom : <TechnicalId id={shortId(identifiant) ?? identifiant} />}
      {date !== null && <span className="ml-2 tabular text-ink-faint">{date}</span>}
    </span>
  );
}
