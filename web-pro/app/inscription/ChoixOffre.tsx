"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui";
import type {
  AnnonceEssai,
  CycleFacturation,
  LigneResume,
  ResumeSouscription,
} from "@/lib/billing/provider";
import type { Catalogue, OffreAffichable } from "./catalogue.ts";
import type { AnnonceEngagement, TexteEngagement } from "./engagement.ts";
import { ouvrirLePaiement, resumerSouscription } from "./actions.ts";

/**
 * LES DEUX JEUX D'ANNONCES D'ENGAGEMENT, préparés au serveur.
 *
 * La date de fin d'engagement dépend du chemin : avec essai, il démarre
 * au premier prélèvement ; sans essai, aujourd'hui. Le navigateur
 * bascule d'un chemin à l'autre, mais IL NE CALCULE PAS LA DATE — un
 * « ajouter un mois » écrit ici dirait le 3 mars pour un 31 janvier. Il
 * choisit entre deux annonces déjà faites.
 */
export type AnnoncesEngagement = {
  avecEssai: AnnonceEngagement[];
  sansEssai: AnnonceEngagement[];
};

/**
 * §15 « Choisir → Résumé → Paiement → Confirmation », joué pour de bon.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE COMPOSANT NE CALCULE AUCUN PRIX. PAS UN.
 * ══════════════════════════════════════════════════════════════════
 *
 * Il n'y a pas une multiplication, pas une addition, pas une division
 * par cent dans ce fichier. Les prix du catalogue arrivent DÉJÀ FORMÉS
 * du serveur (« 79,90 € HT / mois »), et le total du résumé vient d'un
 * aller-retour vers la Server Action `resumerSouscription`, qui le fait
 * produire par le MÊME code que celui qui encaissera. Deux arrondis
 * vaudraient deux montants, et l'écart ne se verrait qu'au relevé
 * bancaire.
 *
 * Ce que le navigateur choisit, c'est une INTENTION : une offre, un
 * rythme, des modules, et le CHEMIN D'ENTRÉE — par l'essai, ou en
 * payant tout de suite. Quatre clés. Aucun montant ne fait le trajet
 * dans ce sens-là, et aucune DATE non plus : le serveur calcule la fin
 * d'essai, le navigateur ne fait que l'afficher.
 *
 * ══════════════════════════════════════════════════════════════════
 * L'ESSAI SE DIT AVANT, AVEC SA DATE
 * ══════════════════════════════════════════════════════════════════
 *
 * « Un mois gratuit, puis 79,90 € HT par mois. Votre carte est
 * enregistrée aujourd'hui et débitée le 6 octobre 2026. » La date est
 * CALCULÉE, pas « dans un mois » : un client surpris par un premier
 * prélèvement fait une réclamation, et il a raison — d'autant qu'une
 * carte enregistrée sans débit laisse facilement croire que rien n'a
 * été souscrit.
 *
 * Et la phrase entière arrive du serveur, montants et date compris. Ce
 * fichier n'ajoute pas un mois à une date, pas plus qu'il n'additionne
 * des centimes.
 *
 * ══════════════════════════════════════════════════════════════════
 * LE RÉSUMÉ EST DEMANDÉ AU SERVEUR À CHAQUE CHANGEMENT
 * ══════════════════════════════════════════════════════════════════
 *
 * Cocher un module ou basculer sur l'année relance l'appel. C'est un
 * aller-retour de plus, et c'est le prix à payer pour que le montant
 * affiché soit EXACTEMENT celui qui sera prélevé : un résumé recomposé
 * à l'écran à partir des prix unitaires finirait par diverger le jour
 * où une remise, un siège ou un prorata s'en mêle.
 *
 * ══════════════════════════════════════════════════════════════════
 * ET LE BOUTON NE PROMET RIEN QU'IL NE PUISSE TENIR
 * ══════════════════════════════════════════════════════════════════
 *
 * Tant que le serveur répond « pas jouable » — offre sur devis, tarif
 * absent chez le prestataire, identité incomplète — le bouton de
 * paiement N'APPARAÎT PAS, et le motif prend sa place. Un bouton qui
 * promet un paiement impossible est pire qu'un bouton absent.
 *
 * ══════════════════════════════════════════════════════════════════
 * L'ENGAGEMENT S'ANNONCE AVANT, PAS AU MOMENT DE RÉSILIER
 * ══════════════════════════════════════════════════════════════════
 *
 * Quand l'offre choisie engage — le tarif fondateur engage sur douze
 * mois — la carte porte la durée et le prix d'après DÈS LA GRILLE, et
 * le résumé montre le texte contractuel EN ENTIER avec une case dédiée,
 * NON PRÉ-COCHÉE. Le bouton de paiement n'apparaît pas tant qu'elle ne
 * l'est pas.
 *
 * Mais cette case-ci n'est qu'un CONFORT, exactement comme le contrôle
 * du SIRET pendant la frappe : la décision appartient à la Server
 * Action (`ouvrirLePaiement`), qui relit la base et refait les mêmes
 * contrôles. Un `fetch` fabriqué à la main ne voit pas cette case ; il
 * voit cette action-là.
 */

type EtatResume =
  | { phase: "inactif" }
  | { phase: "chargement" }
  | { phase: "recu"; resume: ResumeSouscription }
  | { phase: "erreur"; motif: string };

const CYCLES: { valeur: CycleFacturation; label: string }[] = [
  { valeur: "monthly", label: "Au mois" },
  { valeur: "yearly", label: "À l'année" },
];

export function ChoixOffre({
  catalogue,
  planActuel,
  peutSouscrire,
  raisonNonSouscription,
  identiteManquante,
  lienIdentite,
  engagements = { avecEssai: [], sansEssai: [] },
  texteEngagement = null,
  essaiPossible = false,
  datesPremierPrelevement = null,
}: {
  catalogue: Catalogue;
  /** L'offre déjà souscrite, pour la marquer « Votre forfait ». */
  planActuel: string | null;
  /** Le fournisseur d'encaissement peut-il réellement encaisser ? */
  peutSouscrire: boolean;
  /** La phrase à afficher quand il ne le peut pas. */
  raisonNonSouscription: string | null;
  /** Ce qui manque dans la fiche société avant de pouvoir payer. */
  identiteManquante: { libelle: string; raison: string }[];
  /** Où aller compléter la fiche. */
  lienIdentite: string;
  /**
   * Les offres qui ENGAGENT, une par clé d'offre au plus. Une liste et
   * non une `Map` : ce qui traverse la frontière serveur → client doit
   * être sérialisable, et une `Map` ne l'est pas.
   */
  engagements?: AnnoncesEngagement;
  /** Le texte contractuel courant. `null` quand rien n'est publié. */
  texteEngagement?: TexteEngagement | null;
  /**
   * L'ESSAI D'UN MOIS EST-IL OUVERT À CETTE ENTREPRISE ?
   *
   * Il l'est au PREMIER abonnement, et à celui-là seulement — c'est la
   * règle de la base, pas un choix d'écran. Une entreprise qui a déjà
   * été abonnée, même résiliée, n'y a plus droit.
   */
  essaiPossible?: boolean;
  /**
   * LES DEUX DATES DE PREMIER PRÉLÈVEMENT, DÉJÀ MISES EN FORME.
   *
   * Elles ne dépendent pas de l'offre — seulement du chemin choisi — et
   * l'écran peut donc les dire AVANT même qu'une offre soit
   * sélectionnée. C'est le moment où la question se pose vraiment :
   * « si je clique ici, quand serai-je débité ? »
   *
   * Des CHAÎNES et non des dates : formater un jour dans le navigateur,
   * c'est risquer le décalage de fuseau qui affiche le 5 pour un 6.
   */
  datesPremierPrelevement?: { avecEssai: string; sansEssai: string } | null;
}) {
  const router = useRouter();
  const [cycle, setCycle] = useState<CycleFacturation>("monthly");
  const [choisie, setChoisie] = useState<string | null>(null);
  const [modules, setModules] = useState<string[]>([]);
  const [resume, setResume] = useState<EtatResume>({ phase: "inactif" });
  const [paiementEnCours, setPaiementEnCours] = useState(false);
  /**
   * JAMAIS PRÉ-COCHÉE, et remise à faux à chaque changement d'offre.
   * Une case cochée qui survivrait au passage de Pro à Pro Business
   * ferait accepter un engagement qu'on n'a pas relu.
   */
  const [engagementCoche, setEngagementCoche] = useState(false);
  /**
   * LE CHEMIN D'ENTRÉE — par l'essai, ou en payant tout de suite.
   *
   * Le défaut est l'ESSAI quand il est ouvert : c'est la lecture
   * retenue de la décision du dirigeant, « tout nouveau client entre
   * par l'essai ». Quand il ne l'est pas — l'entreprise a déjà été
   * abonnée — il n'y a pas de choix à faire, et la valeur reste
   * « sans essai ».
   */
  const [avecEssai, setAvecEssai] = useState(essaiPossible);

  const offreChoisie = catalogue.offres.find((o) => o.offre.key === choisie) ?? null;
  /**
   * L'ANNONCE D'ENGAGEMENT QUI CORRESPOND AU CHEMIN CHOISI.
   *
   * Les deux jeux sont calculés au serveur ; on choisit, on ne calcule
   * pas. Avec essai, l'engagement démarre au premier prélèvement — un
   * mois plus tard — et sa date de fin n'est donc pas la même.
   */
  const annoncesCourantes = avecEssai ? engagements.avecEssai : engagements.sansEssai;
  const engagementChoisi =
    annoncesCourantes.find((annonce) => annonce.planKey === choisie) ?? null;

  /**
   * CHANGER D'OFFRE REMET LES MODULES À ZÉRO, et ce n'est pas un détail
   * de confort : un module « en option à 20 € » sur Pro est COMPRIS dans
   * Pro Business. Garder la case cochée en changeant d'offre ferait
   * demander — et peut-être facturer — quelque chose qui est déjà inclus.
   */
  function choisirOffre(cle: string) {
    setChoisie(cle);
    setModules([]);
    // L'acceptation vaut pour L'OFFRE qu'on avait sous les yeux. Changer
    // d'offre change la durée, le prix pendant et le prix après : il faut
    // relire et re-cocher.
    setEngagementCoche(false);
    setResume({ phase: "chargement" });
  }

  /**
   * BASCULER DE RYTHME REMET AUSSI LES MODULES À ZÉRO : un module
   * vendable au mois peut n'avoir aucun tarif annuel arrêté, et le
   * garder coché rendrait la souscription entière irréalisable sans
   * qu'on comprenne pourquoi.
   */
  function changerCycle(valeur: CycleFacturation) {
    setCycle(valeur);
    setModules([]);
    // Même raison : un engagement se lit au mois, et basculer le rythme
    // change ce qui sera prélevé. On redemande l'acceptation.
    setEngagementCoche(false);
    if (choisie !== null) setResume({ phase: "chargement" });
  }

  /**
   * CHANGER DE CHEMIN DÉCOCHE L'ENGAGEMENT, ET CE N'EST PAS UN EXCÈS DE
   * ZÈLE.
   *
   * L'essai décale l'engagement d'un mois : la phrase acceptée porte
   * « du 6 octobre 2026 au 6 octobre 2027 », et renoncer à l'essai la
   * transforme en « du 6 septembre 2026 au 6 septembre 2027 ». Garder
   * la case cochée reviendrait à conserver l'acceptation d'un texte que
   * l'écran vient de remplacer sous les yeux de la personne.
   *
   * Le résumé se redemande aussi : c'est lui qui porte la date du
   * premier prélèvement, et elle vient de changer.
   */
  function changerChemin(valeur: boolean) {
    setAvecEssai(valeur);
    setEngagementCoche(false);
    if (choisie !== null) setResume({ phase: "chargement" });
  }

  /**
   * LE RÉSUMÉ SE REDEMANDE À CHAQUE CHANGEMENT D'INTENTION.
   *
   * ══════════════════════════════════════════════════════════════
   * POURQUOI UN EFFET, ET POURQUOI IL S'ANNULE
   * ══════════════════════════════════════════════════════════════
   *
   * L'effet est le bon outil : le résumé doit suivre l'intention quelle
   * que soit la cause du changement — choisir, basculer, cocher — et le
   * recopier dans trois gestionnaires finirait par en oublier un.
   *
   * MAIS DEUX ALLERS-RETOURS PEUVENT REVENIR DANS LE DÉSORDRE. Cocher
   * deux modules coup sur coup lance deux requêtes ; si la première met
   * plus de temps, sa réponse écrase la seconde, et l'écran affiche un
   * montant qui ne correspond plus à ce qui est coché. Sur une page de
   * paiement, c'est précisément l'écart qu'on ne veut jamais.
   *
   * Le nettoyage marque donc la requête comme OBSOLÈTE et l'abandonne :
   * seule la dernière intention a le droit d'écrire. `obsolete` protège
   * l'écriture ; `abort` évite de laisser courir une requête dont plus
   * personne n'attend la réponse.
   *
   * `setResume` n'est appelé que dans un rappel, jamais dans le corps
   * de l'effet : « calcul en cours » est posé par les gestionnaires
   * d'événement ci-dessus, et un `setState` synchrone ici déclencherait
   * une cascade de rendus que React signale à juste titre.
   */
  useEffect(() => {
    if (choisie === null) return;

    let obsolete = false;

    /**
     * ON PASSE PAR LA SERVER ACTION, PLUS PAR LA ROUTE HTTP.
     *
     * La route `/api/stripe/resume` ne sait pas dire « avec essai » ou
     * « sans essai » : son lecteur d'intention n'accepte que trois clés,
     * et c'est très bien qu'il les refuse toutes les autres. Mais le
     * résumé doit poser EXACTEMENT la question que posera le paiement,
     * sinon il annonce une date de prélèvement que le bouton d'à côté
     * ne tiendra pas.
     *
     * L'action, elle, refait les mêmes contrôles côté serveur — session,
     * rôle, lecture d'intention — et appelle le même
     * `previewCheckout()`. Le montant reste calculé par le seul code
     * qui encaisse.
     *
     * `AbortController` disparaît avec le `fetch` : une Server Action ne
     * s'annule pas. Le drapeau `obsolete` reste, et c'est lui qui
     * comptait — il empêche une réponse en retard d'écraser une plus
     * récente, ce qui afficherait un montant qui ne correspond plus à
     * ce qui est coché.
     */
    void resumerSouscription({
      // AUCUN MONTANT NE PART D'ICI. Une offre, un rythme, des modules,
      // un chemin — et l'entreprise vient de la session.
      planKey: choisie,
      billingCycle: cycle,
      moduleKeys: modules,
      avecEssai,
    })
      .then((contenu) => {
        if (!obsolete) setResume({ phase: "recu", resume: contenu });
      })
      .catch(() => {
        if (obsolete) return;
        setResume({
          phase: "erreur",
          motif:
            "Le détail de votre souscription n'a pas pu être chargé. Rien n'a été engagé ; réessayez dans un instant.",
        });
      });

    return () => {
      obsolete = true;
    };
  }, [choisie, cycle, modules, avecEssai]);

  async function payer() {
    if (choisie === null) return;
    setPaiementEnCours(true);
    try {
      /**
       * ON PASSE PAR LA SERVER ACTION, ET C'EST DÉSORMAIS LA SEULE
       * PORTE.
       *
       * C'est elle qui vérifie l'engagement — la case cochée, la version
       * du texte lu, le fait que le tarif annoncé sera bien celui
       * prélevé, et l'existence d'une preuve. La route HTTP qui existait
       * à côté ne connaissait rien de tout cela ; elle a été supprimée
       * plutôt que doublée, parce qu'une porte qui ne vérifie pas reste
       * atteignable même quand plus personne ne l'emprunte.
       */
      const sortie = await ouvrirLePaiement({
        planKey: choisie,
        billingCycle: cycle,
        moduleKeys: modules,
        engagementCoche,
        // La version LUE, pas « la dernière en base » : c'est en les
        // comparant que le serveur refuse une acceptation donnée devant
        // un texte qui a changé depuis.
        versionEngagementAffichee: texteEngagement?.version ?? null,
        // LE CHEMIN, pas la date : le serveur recalcule la date de fin
        // d'essai lui-même. Lui laisser choisir la date reviendrait à
        // laisser le navigateur décider quand il sera débité.
        avecEssai,
      });

      if (sortie.kind === "redirect") {
        // On QUITTE le site pour la page du prestataire — destination
        // EXTERNE, d'où `window.location` et non le routeur, qui ne sait
        // naviguer que dans l'application.
        //
        // Aucun droit n'est ouvert ici : c'est l'événement signé reçu
        // par le webhook qui fera foi, jamais le retour de navigateur
        // qui suivra — celui-là, l'utilisateur peut le fabriquer.
        window.location.href = sortie.url;
        return;
      }
      if (sortie.kind === "completed") {
        // Destination INTERNE : le routeur, qui garde l'application
        // montée au lieu de recharger la page entière.
        router.push("/entreprise/abonnement");
        router.refresh();
        return;
      }
      setResume({ phase: "erreur", motif: sortie.reason });
    } catch {
      setResume({
        phase: "erreur",
        motif: "La page de paiement n'a pas pu être ouverte. Rien n'a été prélevé.",
      });
    } finally {
      setPaiementEnCours(false);
    }
  }

  const identiteIncomplete = identiteManquante.length > 0;
  /**
   * Un engagement non accepté est un empêchement au même titre qu'une
   * fiche incomplète : il se DIT avant le bouton plutôt que de le
   * griser sans explication. Un bouton désactivé sans motif est la
   * façon la plus sûre de faire écrire au support.
   */
  const engagementARegler = engagementChoisi !== null && !engagementCoche;

  return (
    <div className="flex flex-col gap-6">
      {/* ---------------- Le rythme ---------------- */}
      <div className="flex flex-wrap items-center gap-3">
        <div
          role="group"
          aria-label="Rythme de facturation"
          className="inline-flex rounded-[var(--radius-pill)] border border-line-strong bg-surface p-0.5"
        >
          {CYCLES.map((c) => (
            <button
              key={c.valeur}
              type="button"
              onClick={() => changerCycle(c.valeur)}
              aria-pressed={cycle === c.valeur}
              className={`rounded-[var(--radius-pill)] px-3.5 py-1.5 text-[var(--text-secondary)] font-medium transition-colors ${
                cycle === c.valeur ? "bg-accent text-accent-ink" : "text-ink-soft hover:text-ink"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
        <span className="text-[var(--text-secondary)] text-ink-faint">
          Tous les prix sont indiqués hors taxes.
        </span>
      </div>

      {/* ---------------- Le chemin d'entrée ----------------
          Il se choisit AU MÊME NIVEAU que le rythme, et avant l'offre :
          c'est une décision sur l'argent, pas une option enfouie dans
          un dépliant. La date exacte, elle, s'affiche dans le résumé —
          elle dépend de l'offre, donc elle vient du serveur. */}
      {essaiPossible && (
        <div className="flex flex-wrap items-center gap-3">
          <div
            role="group"
            aria-label="Comment commencer"
            className="inline-flex rounded-[var(--radius-pill)] border border-line-strong bg-surface p-0.5"
          >
            <button
              type="button"
              onClick={() => changerChemin(true)}
              aria-pressed={avecEssai}
              className={`rounded-[var(--radius-pill)] px-3.5 py-1.5 text-[var(--text-secondary)] font-medium transition-colors ${
                avecEssai ? "bg-accent text-accent-ink" : "text-ink-soft hover:text-ink"
              }`}
            >
              Un mois d&apos;essai gratuit
            </button>
            <button
              type="button"
              onClick={() => changerChemin(false)}
              aria-pressed={!avecEssai}
              className={`rounded-[var(--radius-pill)] px-3.5 py-1.5 text-[var(--text-secondary)] font-medium transition-colors ${
                !avecEssai ? "bg-accent text-accent-ink" : "text-ink-soft hover:text-ink"
              }`}
            >
              Commencer tout de suite
            </button>
          </div>
          <span className="text-[var(--text-secondary)] text-ink-faint">
            {avecEssai
              ? "Votre carte est enregistrée dès aujourd'hui, mais rien n'est prélevé pendant l'essai"
              : "Le premier mois est prélevé aujourd'hui, puis chaque mois à la même date"}
            {datesPremierPrelevement === null
              ? "."
              : ` — premier prélèvement le ${
                  avecEssai
                    ? datesPremierPrelevement.avecEssai
                    : datesPremierPrelevement.sansEssai
                }.`}
          </span>
        </div>
      )}

      {/* ---------------- La grille ---------------- */}
      <div className="grid gap-4 lg:grid-cols-2">
        {catalogue.offres.map((offre) => (
          <CarteOffre
            key={offre.offre.key}
            offre={offre}
            cycle={cycle}
            choisie={choisie === offre.offre.key}
            actuelle={planActuel === offre.offre.key}
            recommandee={catalogue.recommandation?.planKey === offre.offre.key}
            raisonRecommandation={
              catalogue.recommandation?.planKey === offre.offre.key
                ? catalogue.recommandation.raison
                : null
            }
            engagement={
              annoncesCourantes.find((annonce) => annonce.planKey === offre.offre.key) ?? null
            }
            modulesCoches={choisie === offre.offre.key ? modules : []}
            onChoisir={() => choisirOffre(offre.offre.key)}
            onBasculerModule={(cle) => {
              setModules((precedents) =>
                precedents.includes(cle)
                  ? precedents.filter((m) => m !== cle)
                  : // Triés : l'ordre stable rend la clé d'idempotence
                    // stable côté serveur, sans quoi deux compositions
                    // identiques ouvriraient deux sessions de paiement.
                    [...precedents, cle].sort(),
              );
              setResume({ phase: "chargement" });
            }}
          />
        ))}
      </div>

      {catalogue.matriceIndisponible && (
        <p className="text-[var(--text-secondary)] text-ink-faint">
          Le détail des modules en option n&apos;est pas encore publié. Les offres restent
          souscriptibles telles qu&apos;elles sont décrites.
        </p>
      )}

      {/* ---------------- Le résumé, et le paiement ---------------- */}
      {offreChoisie !== null && (
        <div className="rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-[var(--shadow-card)]">
          <h3 className="text-[length:var(--text-card)] font-semibold">
            Votre souscription — {offreChoisie.offre.name}
          </h3>

          <PanneauResume etat={resume} />

          {/* Ce qui empêche de payer, dit AVANT le bouton. */}
          {identiteIncomplete && (
            <div className="mt-4 rounded-[var(--radius-control)] border border-warning/30 bg-warning-wash p-4">
              <p className="text-[var(--text-body)] font-medium">
                Il manque {identiteManquante.length === 1 ? "une information" : "des informations"}{" "}
                avant de pouvoir payer.
              </p>
              <ul className="mt-2 flex flex-col gap-1.5">
                {identiteManquante.map((manque) => (
                  <li key={manque.libelle} className="text-[var(--text-secondary)] text-ink-soft">
                    <span className="font-medium text-ink">{manque.libelle}</span> — {manque.raison}
                  </li>
                ))}
              </ul>
              <a
                href={lienIdentite}
                className="mt-3 inline-flex items-center rounded-[var(--radius-control)] border border-line-strong bg-surface px-3.5 py-2 text-[var(--text-secondary)] font-medium hover:bg-canvas"
              >
                Compléter la fiche de l&apos;entreprise
              </a>
            </div>
          )}

          {/* ---------------- L'ENGAGEMENT ---------------- */}
          {engagementChoisi !== null && (
            <PanneauEngagement
              annonce={engagementChoisi}
              texte={texteEngagement}
              coche={engagementCoche}
              onCocher={setEngagementCoche}
            />
          )}

          {!peutSouscrire && raisonNonSouscription !== null && (
            <div className="mt-4 border-t border-line pt-4">
              <p className="text-[var(--text-body)] text-ink-soft">{raisonNonSouscription}</p>
              <p className="mt-1.5 text-[var(--text-secondary)] text-ink-faint">
                Aucun bouton de paiement n&apos;est affiché tant que le paiement n&apos;aboutit pas
                réellement — mieux vaut un écran qui ne propose rien qu&apos;un écran qui confirme
                une transaction qui n&apos;a pas eu lieu.
              </p>
            </div>
          )}

          {/* LE BOUTON N'EXISTE QUE SI LES QUATRE CONDITIONS TIENNENT :
              une caisse ouverte, une identité facturable, un résumé que
              le serveur a déclaré jouable — et, quand l'offre engage,
              une acceptation cochée. */}
          {peutSouscrire &&
            !identiteIncomplete &&
            !engagementARegler &&
            resume.phase === "recu" &&
            resume.resume.jouable && (
              <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4">
                <button
                  type="button"
                  onClick={() => void payer()}
                  disabled={paiementEnCours}
                  className="inline-flex items-center justify-center rounded-[var(--radius-control)] bg-accent px-3.5 py-2 text-[var(--text-secondary)] font-medium text-accent-ink transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {/* LE BOUTON DIT CE QU'IL FAIT, ET IL NE FAIT PAS LA
                      MÊME CHOSE DANS LES DEUX CAS. « Procéder au
                      paiement » devant un essai gratuit annoncerait un
                      débit qui n'aura pas lieu aujourd'hui — et la page
                      suivante demanderait quand même une carte, ce qui
                      ressemblerait à une contradiction. */}
                  {paiementEnCours
                    ? "Ouverture de la page sécurisée…"
                    : avecEssai
                      ? "Commencer mon essai gratuit"
                      : "Procéder au paiement"}
                </button>
                <span className="text-[var(--text-secondary)] text-ink-faint">
                  {avecEssai
                    ? "Vous serez redirigé vers notre prestataire de paiement pour enregistrer votre carte. Elle ne sera pas débitée aujourd'hui, et votre abonnement ne prendra effet qu'une fois l'enregistrement confirmé."
                    : "Vous serez redirigé vers notre prestataire de paiement. Votre abonnement ne prendra effet qu'une fois le règlement confirmé."}
                </span>
              </div>
            )}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------
// L'engagement — annoncé, lu, accepté par un geste séparé
// ------------------------------------------------------------------

/**
 * §3.bis « avant de souscrire, celui qui s'abonne est au courant qu'il
 * est engagé ».
 *
 * ══════════════════════════════════════════════════════════════════
 * POURQUOI LE TEXTE EST MONTRÉ EN ENTIER, ET NON DERRIÈRE UN LIEN
 * ══════════════════════════════════════════════════════════════════
 *
 * Ce qui est conservé comme preuve, c'est CE TEXTE-LÀ. Le mettre
 * derrière un lien qu'on peut ne pas ouvrir rendrait la preuve
 * discutable le jour où quelqu'un dira « je ne l'ai jamais vu ». Il
 * tient en un paragraphe : il s'affiche.
 *
 * ══════════════════════════════════════════════════════════════════
 * ET SI LE TEXTE N'EST PAS PUBLIÉ ?
 * ══════════════════════════════════════════════════════════════════
 *
 * On n'affiche PAS de case à cocher. Faire accepter un engagement
 * devant un cadre vide serait pire que de ne rien proposer, et le
 * serveur refuserait de toute façon. On explique, et on s'arrête là.
 */
function PanneauEngagement({
  annonce,
  texte,
  coche,
  onCocher,
}: {
  annonce: AnnonceEngagement;
  texte: TexteEngagement | null;
  coche: boolean;
  onCocher: (valeur: boolean) => void;
}) {
  return (
    <div className="mt-4 rounded-[var(--radius-control)] border border-warning/40 bg-warning-wash p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="warning">{annonce.badge}</Badge>
        <span className="text-[var(--text-body)] font-medium">{annonce.label}</span>
      </div>

      {/* LES TROIS CHIFFRES, ANNONCÉS AVANT. Les chaînes arrivent du
          serveur, mention « HT » comprise : ce gabarit ne peut ni les
          recalculer ni oublier la mention. */}
      {/* LES DATES, AVANT LA CASE — c'est la moitié de l'exigence.
          « Douze mois » se compte de tête et se compte mal ; « jusqu'au
          6 octobre 2027 » se relit. Et quand l'entreprise entre par
          l'essai, l'engagement NE COMMENCE PAS aujourd'hui : il démarre
          au premier prélèvement, un mois plus tard. Le dire est la
          contrepartie honnête de « l'essai ne compte pas dans
          l'engagement » — l'abonné reste treize mois au total, dont un
          gratuit qu'il peut arrêter sans rien devoir.
          La chaîne est calculée au serveur : ce gabarit n'ajoute pas un
          mois à une date. */}
      <p className="mt-2 text-[var(--text-body)] font-medium">
        Engagement {annonce.periodeEngagement}.
      </p>

      <dl className="mt-3 grid gap-2 sm:grid-cols-3">
        <div>
          <dt className="text-[var(--text-secondary)] text-ink-faint">Durée d&apos;engagement</dt>
          <dd className="text-[var(--text-body)] font-medium">{annonce.dureeMois} mois</dd>
        </div>
        <div>
          <dt className="text-[var(--text-secondary)] text-ink-faint">Pendant l&apos;engagement</dt>
          <dd className="tabular text-[var(--text-body)] font-medium">{annonce.prixPendant}</dd>
        </div>
        <div>
          <dt className="text-[var(--text-secondary)] text-ink-faint">
            Ensuite, {annonce.quandLePrixChange}
          </dt>
          <dd className="tabular text-[var(--text-body)] font-medium">{annonce.prixApres}</dd>
        </div>
      </dl>

      {texte === null ? (
        <p className="mt-3 text-[var(--text-body)] text-ink-soft">
          Le texte de cet engagement n&apos;est pas publié pour le moment : il n&apos;y a rien à
          accepter, et rien ne peut donc être prélevé. Écrivez-nous, nous réglons cela.
        </p>
      ) : (
        <>
          {/* LE TEXTE EXACT, celui dont une copie sera conservée. */}
          <div
            className="mt-3 max-h-48 overflow-y-auto whitespace-pre-line rounded-[var(--radius-control)] border border-line bg-surface p-3 text-[var(--text-secondary)] text-ink-soft"
            role="region"
            aria-label="Conditions de l'engagement"
            tabIndex={0}
          >
            {texte.texte}
          </div>
          <p className="mt-1.5 text-[var(--text-secondary)] text-ink-faint">
            Version {texte.version}. Une copie de ce texte sera conservée avec votre acceptation.
          </p>

          {/* LA CASE, DÉDIÉE ET NON PRÉ-COCHÉE.
              Elle ne porte QUE l'engagement — pas les conditions
              générales, pas la lettre d'information. Une case qui
              regroupe plusieurs acceptations n'en prouve aucune.
              (Le produit n'a pas encore de conditions générales ; le
              jour où elles arriveront, elles auront leur propre case.) */}
          <label className="mt-3 flex cursor-pointer items-start gap-2.5">
            <input
              type="checkbox"
              checked={coche}
              onChange={(evenement) => onCocher(evenement.target.checked)}
              className="mt-1 shrink-0"
            />
            <span className="text-[var(--text-body)]">{annonce.phraseAcceptation}</span>
          </label>

          {!coche && (
            <p className="mt-2 text-[var(--text-secondary)] text-ink-faint" aria-live="polite">
              Tant que cette case n&apos;est pas cochée, aucun paiement ne peut partir.
            </p>
          )}
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------
// Le résumé
// ------------------------------------------------------------------

function PanneauResume({ etat }: { etat: EtatResume }) {
  if (etat.phase === "inactif") return null;

  if (etat.phase === "chargement") {
    return (
      <p className="mt-3 text-[var(--text-body)] text-ink-faint" aria-live="polite">
        Calcul du montant…
      </p>
    );
  }

  if (etat.phase === "erreur") {
    return (
      <p className="mt-3 text-[var(--text-body)] text-critical" aria-live="polite">
        {etat.motif}
      </p>
    );
  }

  const resume = etat.resume;

  if (!resume.jouable) {
    // « Pas jouable » n'est pas une erreur : c'est une réponse, et elle
    // dit quoi faire. L'afficher en rouge ferait croire à une panne.
    return (
      <p className="mt-3 text-[var(--text-body)] text-ink-soft" aria-live="polite">
        {resume.motif}
      </p>
    );
  }

  return (
    <div className="mt-3" aria-live="polite">
      <table className="w-full text-[var(--text-body)]">
        <tbody>
          {resume.lignes.map((ligne: LigneResume) => (
            <tr key={`${ligne.nature}-${ligne.moduleKey ?? ligne.libelle}`}>
              <td className="py-1 pr-3 text-ink-soft">
                {ligne.libelle}
                {ligne.quantite !== 1 && (
                  <span className="text-ink-faint"> × {ligne.quantite}</span>
                )}
              </td>
              <td className="tabular py-1 text-right">
                {/* Le total de la ligne vient du SERVEUR : il n'est pas
                    recalculé ici à partir de la quantité et du prix
                    unitaire, sinon l'écran finirait par annoncer autre
                    chose que ce qui sera prélevé. */}
                {formaterCentimesRecus(ligne.totalLigneHtCents)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-line">
            <td className="py-2 pr-3 font-medium">
              Total {resume.billingCycle === "yearly" ? "annuel" : "mensuel"}
            </td>
            <td className="tabular py-2 text-right text-[1.125rem] font-semibold">
              {formaterCentimesRecus(resume.totalHtCents)} {resume.mentionPrix}
            </td>
          </tr>
        </tfoot>
      </table>

      {resume.modulesInclusSansFrais.length > 0 && (
        <p className="mt-2 text-[var(--text-secondary)] text-positive">
          Compris sans supplément dans cette offre : {resume.modulesInclusSansFrais.join(", ")}.
        </p>
      )}

      {resume.remise !== null && (
        <p className="mt-2 text-[var(--text-secondary)] text-ink-soft">
          <span className="font-medium text-ink">{resume.remise.label}</span> appliqué jusqu&apos;au{" "}
          {new Date(resume.remise.finLe).toLocaleDateString("fr-FR", {
            day: "numeric",
            month: "long",
            year: "numeric",
          })}
          , puis retour au tarif public de {formaterCentimesRecus(resume.remise.prixPublicHtCents)} HT.
        </p>
      )}

      {/* LE MONTANT PRÉLEVÉ N'EST PAS LE PRIX AFFICHÉ, et on le MONTRE
          plutôt que de l'annoncer.
          Cette zone se contentait d'une promesse — « la TVA sera
          ajoutée » — sans jamais dire combien. Découvrir l'écart sur son
          relevé bancaire est la première cause de contestation, et
          79,90 qui deviennent 95,88 sans prévenir ressemble à une
          erreur même quand tout est juste. Le chiffre vient du SERVEUR,
          calculé par le même code que ce qui sera réellement encaissé. */}
      <div className="mt-3 border-t border-line pt-3">
        {resume.taxe.montantTvaCents > 0 ? (
          <>
            <div className="flex justify-between text-[var(--text-secondary)] text-ink-soft">
              <span>TVA {(resume.taxe.tauxBps / 100).toLocaleString("fr-FR")} %</span>
              <span className="tabular">{formaterCentimesRecus(resume.taxe.montantTvaCents)}</span>
            </div>
            <div className="mt-1 flex justify-between font-semibold">
              <span>Montant prélevé</span>
              <span className="tabular">
                {formaterCentimesRecus(resume.taxe.totalTtcCents)} TTC
              </span>
            </div>
          </>
        ) : (
          <div className="flex justify-between font-semibold">
            <span>Montant prélevé</span>
            <span className="tabular">{formaterCentimesRecus(resume.taxe.totalTtcCents)}</span>
          </div>
        )}

        <p className="mt-2 text-[var(--text-secondary)] text-ink-faint">
          {resume.taxe.regime === "france"
            ? "Les prix affichés sont hors taxes ; la TVA française s'y ajoute et figure sur votre facture."
            : resume.taxe.regime === "euReverseCharge"
              ? "Autoliquidation : la TVA est due par votre entreprise dans son pays. Nous ne la prélevons pas, et votre facture porte la mention correspondante."
              : "Prestation hors du champ de la TVA française : aucune taxe n'est ajoutée."}
        </p>
      </div>

      {resume.essai !== null && <PanneauEssai annonce={resume.essai} />}
    </div>
  );
}

/**
 * QUAND LA CARTE SERA DÉBITÉE — DIT AVANT, PAS APRÈS.
 *
 * ══════════════════════════════════════════════════════════════════
 * UNE DATE, PAS « DANS UN MOIS »
 * ══════════════════════════════════════════════════════════════════
 *
 * « Dans un mois » ne se retrouve nulle part sur un relevé bancaire ;
 * une date, si. Un client surpris par un premier prélèvement fait une
 * réclamation, et il a raison — surtout quand la carte a été
 * enregistrée un mois plus tôt sans rien débiter, ce qui laisse
 * facilement croire que rien n'a été souscrit.
 *
 * TOUTES LES PHRASES VIENNENT DU SERVEUR, montants et dates compris.
 * Ce gabarit ne calcule rien, n'ajoute pas un mois, ne formate pas une
 * date : il affiche. C'est ce qui garantit que la date lue ici est
 * exactement celle qui part au prestataire de paiement.
 */
function PanneauEssai({ annonce }: { annonce: AnnonceEssai }) {
  return (
    <div
      className={`mt-4 rounded-[var(--radius-control)] border p-4 ${
        annonce.plan.avecEssai
          ? "border-positive/30 bg-positive-wash"
          : "border-line bg-surface-sunken"
      }`}
      aria-live="polite"
    >
      <p className="text-[var(--text-body)] font-medium">{annonce.titre}</p>
      <p className="mt-1.5 text-[var(--text-body)] text-ink-soft">{annonce.carte}</p>
      <p className="mt-1 tabular text-[var(--text-body)] text-ink-soft">{annonce.prelevement}</p>
      {annonce.sortie !== null && (
        <p className="mt-2 text-[var(--text-secondary)] text-ink-faint">{annonce.sortie}</p>
      )}
    </div>
  );
}

/**
 * LA SEULE MISE EN FORME FAITE ICI, ET ELLE NE CALCULE RIEN.
 *
 * Une division par cent pour l'affichage n'est pas un calcul de prix :
 * le montant DÉCIDÉ reste l'entier en centimes rendu par le serveur, et
 * rien ici ne l'additionne, ne le multiplie ni ne l'arrondit. Le total,
 * les totaux de ligne et le prix public de retour arrivent tous
 * calculés.
 */
function formaterCentimesRecus(cents: number): string {
  return `${(cents / 100).toLocaleString("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} €`;
}

// ------------------------------------------------------------------
// Une carte d'offre
// ------------------------------------------------------------------

function CarteOffre({
  offre,
  cycle,
  choisie,
  actuelle,
  recommandee,
  raisonRecommandation,
  engagement,
  modulesCoches,
  onChoisir,
  onBasculerModule,
}: {
  offre: OffreAffichable;
  cycle: CycleFacturation;
  choisie: boolean;
  actuelle: boolean;
  recommandee: boolean;
  raisonRecommandation: string | null;
  /** L'engagement attaché à cette offre, annoncé AVANT tout choix. */
  engagement: AnnonceEngagement | null;
  modulesCoches: string[];
  onChoisir: () => void;
  onBasculerModule: (cle: string) => void;
}) {
  const surDevis = offre.offre.isQuoteOnly;
  const prix = cycle === "yearly" ? offre.prixAnnuel : offre.prixMensuel;
  const options = offre.optionsParCycle[cycle];

  // Une offre annuelle qui n'a pas de tarif annuel ne se souscrit pas à
  // l'année : on le dit, plutôt que de laisser cliquer sur un bouton qui
  // échouera au résumé.
  const annuelImpossible = cycle === "yearly" && !offre.annuelDisponible;

  return (
    <div
      className={`flex flex-col rounded-[var(--radius-card)] border p-5 ${
        choisie
          ? "border-accent bg-accent-wash/40 shadow-[var(--shadow-raised)]"
          : "border-line bg-surface shadow-[var(--shadow-card)]"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="text-[length:var(--text-card)] font-semibold">{offre.offre.name}</h3>
        <div className="flex flex-wrap gap-1.5">
          {actuelle && <Badge tone="accent">Votre forfait</Badge>}
          {offre.badge === "bestSeller" && <Badge tone="positive">Le plus choisi</Badge>}
          {offre.badge === "new" && <Badge tone="info">Nouveau</Badge>}
          {surDevis && <Badge tone="neutral">Sur devis</Badge>}
          {/* L'ENGAGEMENT SE VOIT AVANT LE CLIC. Un client qui le
              découvre au moment de résilier est une réclamation
              certaine, et il aura raison. */}
          {engagement !== null && <Badge tone="warning">{engagement.badge}</Badge>}
        </div>
      </div>

      {offre.offre.tagline && (
        <p className="mt-1 text-[var(--text-secondary)] text-ink-soft">{offre.offre.tagline}</p>
      )}

      {/* LE PRIX, AVEC SA MENTION. La chaîne arrive du serveur mention
          comprise : il n'existe aucun chemin par lequel ce gabarit
          pourrait afficher un montant nu. */}
      <p className="tabular mt-3 text-[1.5rem] font-semibold leading-none">
        {surDevis
          ? (offre.prixPlancher ?? "Sur devis")
          : (prix ?? "Tarif non publié")}
      </p>
      {cycle === "yearly" && offre.economieAnnuelle !== null && (
        <p className="mt-1.5 text-[var(--text-secondary)] text-positive">{offre.economieAnnuelle}</p>
      )}

      {/* LA PHRASE COMPLÈTE, sur la carte et non dans une infobulle :
          durée, prix pendant, prix après. Les trois chiffres arrivent
          formés du serveur, mention « HT » comprise. */}
      {engagement !== null && (
        <p className="mt-2 rounded-[var(--radius-control)] bg-warning-wash px-3 py-2 text-[var(--text-secondary)] text-ink-soft">
          {engagement.resume}
        </p>
      )}

      {recommandee && raisonRecommandation !== null && (
        <p className="mt-3 rounded-[var(--radius-control)] bg-info-wash px-3 py-2 text-[var(--text-secondary)] text-info">
          {raisonRecommandation}
        </p>
      )}

      <ul className="mt-4 flex flex-1 flex-col gap-1.5">
        {offre.offre.features.map((feature) => (
          <li key={feature} className="flex items-start gap-2 text-[var(--text-body)]">
            <span aria-hidden className="mt-0.5 shrink-0 text-accent">
              ✓
            </span>
            <span className="text-ink-soft">{feature}</span>
          </li>
        ))}
      </ul>

      {/* ---------------- Les modules, selon la matrice ---------------- */}
      {options.length > 0 && (
        <div className="mt-4 border-t border-line pt-4">
          <p className="text-[var(--text-secondary)] font-medium text-ink-soft">Modules</p>
          <ul className="mt-2 flex flex-col gap-2">
            {options.map((option) => (
              <li key={option.module.key}>
                <label
                  className={`flex items-start gap-2 text-[var(--text-body)] ${
                    option.cochable && choisie ? "cursor-pointer" : "cursor-default"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={option.compris || modulesCoches.includes(option.module.key)}
                    // Un module compris s'affiche coché ET verrouillé :
                    // il EST dans l'offre, on ne peut ni l'ajouter ni le
                    // retirer.
                    disabled={!option.cochable || !choisie || option.compris}
                    onChange={() => onBasculerModule(option.module.key)}
                    className="mt-1 shrink-0"
                  />
                  <span className="min-w-0">
                    <span className={option.compris ? "text-ink" : "text-ink-soft"}>
                      {option.module.name}
                    </span>
                    {option.prix !== null && (
                      <span className="tabular font-medium"> — {option.prix}</span>
                    )}
                    {option.motif !== null && (
                      <span className="block text-[var(--text-secondary)] text-ink-faint">
                        {option.motif}
                      </span>
                    )}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ---------------- L'action ---------------- */}
      <div className="mt-5">
        {surDevis ? (
          /* Une offre sur devis NE SE SOUSCRIT PAS : la base le refuse
             (`organization_subscriptions_plan_guard`), et un bouton qui
             mènerait au tunnel enverrait le visiteur dans un cul-de-sac.
             On l'envoie parler à quelqu'un. */
          <a
            href="/aide#contact"
            className="inline-flex w-full items-center justify-center rounded-[var(--radius-control)] border border-line-strong bg-surface px-3.5 py-2 text-[var(--text-secondary)] font-medium hover:bg-canvas"
          >
            Nous contacter
          </a>
        ) : annuelImpossible ? (
          <p className="text-[var(--text-secondary)] text-ink-faint">
            Cette offre n&apos;a pas de tarif annuel publié. Choisissez « Au mois » pour la
            souscrire.
          </p>
        ) : !offre.souscriptibleEnLigne ? (
          <p className="text-[var(--text-secondary)] text-ink-faint">
            Le tarif de cette offre n&apos;est pas encore publié : elle ne peut pas être souscrite
            en ligne.
          </p>
        ) : (
          <button
            type="button"
            onClick={onChoisir}
            aria-pressed={choisie}
            className={`inline-flex w-full items-center justify-center rounded-[var(--radius-control)] px-3.5 py-2 text-[var(--text-secondary)] font-medium transition-colors ${
              choisie
                ? "bg-accent text-accent-ink hover:bg-accent-hover"
                : "border border-line-strong bg-surface text-ink hover:bg-canvas"
            }`}
          >
            {choisie ? "Offre sélectionnée" : "Choisir cette offre"}
          </button>
        )}
      </div>
    </div>
  );
}
