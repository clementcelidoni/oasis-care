"use client";

import { useState } from "react";
import { SubmitButton } from "@/components/ui";
import {
  tvaFrancaiseAttendue,
  verifierCoherenceSirenSiret,
  verifierSiren,
  verifierSiret,
  verifierTvaIntracom,
  zoneFiscale,
  type EtatChamp,
} from "./identite.ts";

/**
 * §INSCRIPTION — LA FICHE SOCIÉTÉ, CONTRÔLÉE PENDANT LA FRAPPE.
 *
 * ══════════════════════════════════════════════════════════════════
 * POURQUOI CE COMPOSANT EST CLIENT, ET CE QU'IL NE DÉCIDE PAS
 * ══════════════════════════════════════════════════════════════════
 *
 * Il appelle EXACTEMENT les mêmes fonctions que la Server Action —
 * `identite.ts` est pur, sans base ni réseau, donc il tourne des deux
 * côtés. C'est ce qui garantit qu'on ne verra jamais un formulaire vert
 * refusé par le serveur, ni l'inverse : il n'y a qu'un seul jeu de
 * règles, écrit une fois.
 *
 * Mais ce contrôle-ci n'est qu'un CONFORT. La décision appartient au
 * serveur, qui refait tout (`actions.ts`). Un `fetch` fabriqué à la
 * main ne voit pas ce composant.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE QUI SE VÉRIFIE ICI, ET CE QUI RESTE INVÉRIFIABLE
 * ══════════════════════════════════════════════════════════════════
 *
 * La clé de Luhn du SIRET et du SIREN, leur cohérence entre eux, la clé
 * du numéro de TVA français — tout cela se calcule hors ligne, sans
 * demander la permission à personne.
 *
 * Que l'entreprise EXISTE, qu'elle ne soit pas cessée, qu'un numéro de
 * TVA étranger soit réellement attribué : rien de tout cela ne se
 * vérifie ici, et l'écran le DIT plutôt que d'afficher une coche verte
 * qui ne voudrait rien dire.
 */

/** Les tons d'un champ, et « invérifiable » qui n'est ni vert ni rouge. */
const TON: Record<EtatChamp, string> = {
  vide: "border-line-strong",
  valide: "border-positive",
  invalide: "border-critical",
  inverifiable: "border-warning",
};

const TEXTE_TON: Record<EtatChamp, string> = {
  vide: "text-ink-faint",
  valide: "text-positive",
  invalide: "text-critical",
  inverifiable: "text-warning",
};

const CLASSE_CHAMP =
  "w-full rounded-[var(--radius-control)] border bg-surface px-3 py-2 text-[var(--text-body)] outline-none placeholder:text-ink-faint focus:border-accent";

function Champ({
  label,
  name,
  valeur,
  onChange,
  etat = "vide",
  message,
  aide,
  placeholder,
  requis = false,
  autoComplete,
}: {
  label: string;
  name: string;
  valeur: string;
  onChange: (v: string) => void;
  etat?: EtatChamp;
  message?: string | null;
  aide?: string;
  placeholder?: string;
  requis?: boolean;
  autoComplete?: string;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
        {label}
        {requis && <span className="text-critical"> *</span>}
      </span>
      <input
        name={name}
        value={valeur}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        aria-invalid={etat === "invalide"}
        className={`${CLASSE_CHAMP} ${TON[etat]}`}
      />
      {/* Le message de contrôle prime sur l'aide : quand il y a une
          faute, répéter la consigne générale noierait la correction. */}
      {message ? (
        <span className={`text-[var(--text-secondary)] ${TEXTE_TON[etat]}`}>{message}</span>
      ) : aide ? (
        <span className="text-[var(--text-secondary)] text-ink-faint">{aide}</span>
      ) : null}
    </label>
  );
}

export type ValeursSociete = {
  name: string;
  business_type: string;
  legal_name: string;
  legal_form: string;
  siren: string;
  siret: string;
  vat_number: string;
  rcs_city: string;
  address_line1: string;
  address_line2: string;
  postal_code: string;
  city: string;
  country: string;
  email: string;
  phone: string;
};

/** Les champs de la fiche que l'action réécrit mais que cet écran n'affiche pas. */
export type ValeursPortees = Record<string, string>;

export function FormulaireSociete({
  action,
  valeurs,
  portees,
  metiers,
  pays,
  champEnFaute,
  messageEnFaute,
  entrepriseExiste,
}: {
  action: (formData: FormData) => void | Promise<void>;
  valeurs: ValeursSociete;
  portees: ValeursPortees;
  metiers: { value: string; label: string }[];
  pays: { value: string; label: string }[];
  champEnFaute: string | null;
  messageEnFaute: string | null;
  entrepriseExiste: boolean;
}) {
  const [v, setV] = useState<ValeursSociete>(valeurs);
  const set = (cle: keyof ValeursSociete) => (valeur: string) =>
    setV((precedent) => ({ ...precedent, [cle]: valeur }));

  const zone = zoneFiscale(v.country);

  const siret = verifierSiret(v.siret);
  const siren = verifierSiren(v.siren);
  const coherence = verifierCoherenceSirenSiret(v.siren, v.siret);

  /**
   * Le SIREN se déduit du SIRET — mais SEULEMENT d'un SIRET complet et
   * valide. Prendre les neuf premiers chiffres d'une saisie en cours
   * (« 7328 ») produirait un SIREN tronqué, que le contrôle de TVA
   * comparerait au vrai et déclarerait faux : une erreur rouge qui
   * apparaît pendant qu'on tape, et qui n'existe pas.
   */
  const sirenDeduit = siret.etat === "valide" ? siret.valeur!.slice(0, 9) : null;
  const sirenEffectif = v.siren.trim() !== "" ? v.siren : sirenDeduit;

  const tva = verifierTvaIntracom(v.vat_number, v.country, sirenEffectif);

  const sirenPropose = v.siren.trim() === "" ? sirenDeduit : null;
  const tvaProposee =
    zone === "france" && v.vat_number.trim() === "" ? tvaFrancaiseAttendue(sirenEffectif) : null;

  /**
   * Le message affiché sur un champ : celui du serveur d'abord (il a
   * refusé, il a la priorité), puis celui du contrôle local.
   */
  function messagePour(champ: string, local: string | null): string | null {
    if (champEnFaute === champ && messageEnFaute) return messageEnFaute;
    return local;
  }

  function etatPour(champ: string, local: EtatChamp): EtatChamp {
    if (champEnFaute === champ && messageEnFaute) return "invalide";
    return local;
  }

  return (
    <form action={action} className="flex flex-col gap-6">
      {/* Les champs que l'action réécrit mais que cette étape n'affiche
          pas. Sans eux, `updateCompanyProfile` — qui enregistre la fiche
          ENTIÈRE — remettrait à null tout ce qui a été saisi ailleurs. */}
      {Object.entries(portees).map(([cle, valeur]) => (
        <input key={cle} type="hidden" name={cle} defaultValue={valeur} />
      ))}

      {/* ---------------- Identité ---------------- */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Champ
          label="Nom de l'entreprise"
          name="name"
          valeur={v.name}
          onChange={set("name")}
          requis
          etat={etatPour("name", v.name.trim() === "" ? "vide" : "valide")}
          message={messagePour("name", null)}
          aide="Le nom que vous employez au quotidien."
          autoComplete="organization"
        />

        <label className="flex flex-col gap-1.5">
          <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
            Votre métier<span className="text-critical"> *</span>
          </span>
          {/* Le métier se fixe à la CRÉATION et ne se change plus ici :
              il gouverne le menu de toute l'application, et le modifier
              au milieu d'un tunnel de paiement changerait l'offre
              recommandée sous les yeux du client.
              Le `name` disparaît quand le champ est verrouillé — un
              `select` désactivé n'est de toute façon pas envoyé, et
              laisser deux champs du même nom dans le formulaire rendrait
              la valeur retenue dépendante de l'ordre du DOM. */}
          <select
            name={entrepriseExiste ? undefined : "business_type"}
            value={v.business_type}
            onChange={(e) => set("business_type")(e.target.value)}
            className={`${CLASSE_CHAMP} border-line-strong`}
            disabled={entrepriseExiste}
          >
            {metiers.map((metier) => (
              <option key={metier.value} value={metier.value}>
                {metier.label}
              </option>
            ))}
          </select>
          <span className="text-[var(--text-secondary)] text-ink-faint">
            {entrepriseExiste
              ? "Le métier gouverne le menu de l'application. Il se change depuis la fiche de l'entreprise."
              : "Il détermine le menu de l'application, et l'offre qui vous sera conseillée à l'étape suivante."}
          </span>
          {/* Un `select` désactivé n'est pas envoyé par le navigateur :
              sans ce champ caché, changer d'étape effacerait le métier. */}
          {entrepriseExiste && <input type="hidden" name="business_type" value={v.business_type} />}
        </label>

        <Champ
          label="Dénomination sociale"
          name="legal_name"
          valeur={v.legal_name}
          onChange={set("legal_name")}
          etat={etatPour("legal_name", v.legal_name.trim() === "" ? "vide" : "valide")}
          message={messagePour("legal_name", null)}
          aide="Telle qu'elle figure au registre — c'est elle qui sera imprimée sur vos factures."
        />

        <Champ
          label="Forme juridique"
          name="legal_form"
          valeur={v.legal_form}
          onChange={set("legal_form")}
          placeholder="SARL, SAS, EI…"
        />
      </div>

      {/* ---------------- Pays, puis les identifiants qu'il commande ---------------- */}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
            Pays<span className="text-critical"> *</span>
          </span>
          <select
            name="country"
            value={v.country}
            onChange={(e) => set("country")(e.target.value)}
            className={`${CLASSE_CHAMP} border-line-strong`}
          >
            {pays.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
          <span className="text-[var(--text-secondary)] text-ink-faint">
            {/* Le pays n'est pas un champ d'adresse comme un autre : il
                décide de la TVA applicable, donc de ce qui sera prélevé. */}
            {zone === "france"
              ? "Vos factures porteront la TVA française (20 %)."
              : zone === "unionEuropeenne"
                ? "Union européenne : vos factures s'établiront en autoliquidation, sur présentation de votre numéro de TVA intracommunautaire."
                : "Hors Union européenne : vos factures seront établies hors champ de la TVA française."}
          </span>
        </label>

        <div />

        <Champ
          label="SIRET"
          name="siret"
          valeur={v.siret}
          onChange={set("siret")}
          requis={zone === "france"}
          etat={etatPour("siret", coherence.etat === "invalide" ? "invalide" : siret.etat)}
          message={messagePour(
            "siret",
            coherence.etat === "invalide" ? coherence.message : siret.message,
          )}
          aide={
            zone === "france"
              ? "14 chiffres, sur votre Kbis. Une facture française doit le porter — sans lui, nous ne pourrons pas l'émettre."
              : "Facultatif hors de France."
          }
          placeholder="732 829 320 00074"
        />

        <Champ
          label="SIREN"
          name="siren"
          valeur={v.siren}
          onChange={set("siren")}
          etat={etatPour("siren", siren.etat)}
          message={messagePour(
            "siren",
            siren.message ??
              (sirenPropose !== null
                ? `Déduit de votre SIRET : ${sirenPropose}. Laissez vide, nous l'enregistrerons.`
                : null),
          )}
          aide="9 chiffres. Ce sont les 9 premiers de votre SIRET."
        />

        <Champ
          label="Numéro de TVA intracommunautaire"
          name="vat_number"
          valeur={v.vat_number}
          onChange={set("vat_number")}
          requis={zone === "unionEuropeenne"}
          etat={etatPour("vat_number", tva.etat)}
          message={messagePour(
            "vat_number",
            tva.message ??
              (tvaProposee !== null
                ? `Calculé depuis votre SIREN : ${tvaProposee}. Laissez vide si vous n'en avez pas.`
                : null),
          )}
          aide={
            zone === "unionEuropeenne"
              ? "Obligatoire pour facturer en autoliquidation. Il sera contrôlé auprès du service européen avant votre première facture."
              : "Il se déduit de votre SIREN. Renseignez-le si le vôtre fait exception."
          }
          placeholder={zone === "france" ? "FR44732829320" : ""}
        />

        <Champ
          label="Ville du RCS"
          name="rcs_city"
          valeur={v.rcs_city}
          onChange={set("rcs_city")}
          aide="Mention obligatoire sur vos propres factures clients."
        />
      </div>

      {/* ---------------- Adresse ---------------- */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Champ
          label="Adresse"
          name="address_line1"
          valeur={v.address_line1}
          onChange={set("address_line1")}
          etat={etatPour("address_line1", v.address_line1.trim() === "" ? "vide" : "valide")}
          message={messagePour("address_line1", null)}
          autoComplete="address-line1"
        />
        <Champ
          label="Complément d'adresse"
          name="address_line2"
          valeur={v.address_line2}
          onChange={set("address_line2")}
          autoComplete="address-line2"
        />
        <Champ
          label="Code postal"
          name="postal_code"
          valeur={v.postal_code}
          onChange={set("postal_code")}
          autoComplete="postal-code"
        />
        <Champ
          label="Ville"
          name="city"
          valeur={v.city}
          onChange={set("city")}
          autoComplete="address-level2"
        />
        <Champ
          label="E-mail de facturation"
          name="email"
          valeur={v.email}
          onChange={set("email")}
          aide="C'est là que partiront vos factures."
          autoComplete="email"
        />
        <Champ
          label="Téléphone"
          name="phone"
          valeur={v.phone}
          onChange={set("phone")}
          autoComplete="tel"
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton>Continuer vers les offres</SubmitButton>
        <span className="text-[var(--text-secondary)] text-ink-faint">
          Vous pourrez compléter cette fiche plus tard : seul le paiement exige une identité
          complète.
        </span>
      </div>
    </form>
  );
}
