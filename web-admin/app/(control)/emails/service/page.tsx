import type { Metadata } from "next";

import { ReadFailure } from "@/components/customers/read-failure";
import {
  Badge,
  Card,
  EmptyState,
  Notice,
  PageHeader,
  Panel,
  StatusBadge,
  Tabs,
} from "@/components/ui";
import { requireAdmin } from "@/lib/auth/guard";
import {
  LIBELLES_DECLENCHEUR,
  LIBELLES_NATURE,
  TONS_DECLENCHEUR,
  TONS_NATURE,
  estNature,
} from "@/lib/email/libelles";
import { ongletsCourrier } from "@/lib/email/onglets";
import { listerGabarits } from "@/lib/email/source";
import type { LigneGabarit } from "@/lib/email/types";

export const metadata: Metadata = { title: "Messages de service · Oasis Admin" };

/**
 * ==================================================================
 * CE QU'OASIS ADMIN NE SAIT PAS ENCORE ENVOYER
 * ==================================================================
 *
 * Trois choses ont été demandées pour ce panneau : la bienvenue, le
 * changement de paramètre important, et la publicité. UNE SEULE peut
 * partir d'ici, et cet écran existe pour dire lesquelles ne le peuvent
 * pas — plutôt que de laisser chercher le bouton.
 *
 * POURQUOI ELLES NE LE PEUVENT PAS, précisément :
 * `email_enqueue()` est le seul chemin d'écriture du journal, et 0084
 * § 15.c la réserve à `service_role`. Un jeton de navigateur ne met
 * rien en file, et c'est une bonne décision — c'est elle qui empêche un
 * formulaire de devenir un relais de courrier indésirable. Pour la
 * publicité, 0084 fournit le pont : `admin_send_email_campaign()`, une
 * fonction `security definer` qui vérifie la permission, exige le
 * second facteur et un motif, puis appelle `email_enqueue` pour le
 * compte de l'administrateur. Pour les messages de service,
 * L'ÉQUIVALENT N'EXISTE PAS.
 *
 * CE QU'IL FAUDRAIT, et c'est écrit ici pour que ce soit une décision
 * et pas un oubli : une fonction du même genre — disons
 * `admin_send_service_email(entreprise, gabarit, motif, variables)` —
 * restreinte aux gabarits dont l'audience est « entreprise » et la
 * nature « transactionnel », écrivant dans `admin_audit_events` avec
 * son motif, derrière une permission neuve (`emails.service.send`)
 * semée EXPLICITEMENT pour le super-administrateur. Sans le semis
 * explicite, la permission n'est portée par personne et l'écran
 * disparaît sans un mot : le piège a déjà mordu trois fois.
 *
 * IL Y A UNE NUANCE POUR LA BIENVENUE, et elle n'est pas un détail. Ce
 * message est déclaré « changement d'état » : il part quand
 * `onboarding_completed_at` est posée, depuis Oasis Care Pro. Un bouton
 * « envoyer la bienvenue » dans Oasis Admin serait une SECONDE source
 * pour le même message — et le jour où les deux partent, le client
 * reçoit deux fois la même chose. Ce qu'il faut ici est un geste de
 * RATTRAPAGE, pour l'entreprise que le déclencheur a manquée, pas un
 * second chemin ordinaire. La clé d'idempotence de `email_messages` le
 * garantit déjà côté base — le même gabarit sur la même organisation
 * ne peut pas partir deux fois — mais l'écran doit dire ce qu'il est.
 */
export default async function MessagesDeServicePage() {
  // Aucune permission de courrier n'est exigée : cet écran EXPLIQUE une
  // absence. La fermer à quelqu'un reviendrait à lui cacher ce que le
  // produit ne sait pas faire.
  const admin = await requireAdmin();
  const onglets = ongletsCourrier(admin);

  let gabarits: LigneGabarit[] = [];
  let echec: unknown = null;
  try {
    gabarits = await listerGabarits();
  } catch (error) {
    echec = error;
  }

  const versEntreprise = gabarits.filter((g) => g.audience === "entreprise");
  const versClientFinal = gabarits.filter((g) => g.audience === "clientFinal");

  function Ligne({ gabarit }: { gabarit: LigneGabarit }) {
    const nature = estNature(gabarit.nature) ? gabarit.nature : null;
    const depuisAdmin = gabarit.key === "annonceCommerciale";

    return (
      <li className="px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[var(--text-body)] font-medium text-ink">{gabarit.label}</p>
            <code className="mt-0.5 inline-block rounded bg-surface-sunken px-1.5 py-0.5 font-mono text-[11px] text-ink-faint">
              {gabarit.key}
            </code>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {nature !== null && (
              <Badge tone={TONS_NATURE[nature]}>{LIBELLES_NATURE[nature]}</Badge>
            )}
            <StatusBadge tone={TONS_DECLENCHEUR[gabarit.trigger_kind] ?? "neutral"}>
              {LIBELLES_DECLENCHEUR[gabarit.trigger_kind] ?? gabarit.trigger_kind}
            </StatusBadge>
            {depuisAdmin ? (
              <StatusBadge tone="positive">Part d&apos;Oasis Admin</StatusBadge>
            ) : (
              <StatusBadge tone="unknown">Pas de bouton ici</StatusBadge>
            )}
          </div>
        </div>
        {gabarit.description !== null && (
          <p className="mt-1.5 max-w-4xl text-[var(--text-secondary)] leading-relaxed text-ink-soft">
            {gabarit.description}
          </p>
        )}
      </li>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Courrier"
        title="Messages de service"
        subtitle="Ce que le produit sait envoyer, qui le déclenche, et ce qu'Oasis Admin ne peut pas encore expédier."
      />

      <Tabs items={onglets} current="/emails/service" />

      <Notice tone="unknown" title="La bienvenue et le changement de paramètre n'ont pas de bouton ici">
        Les deux gabarits existent, leur texte est écrit, et la couche d&apos;envoi sait les
        rendre. Ce qui manque est le PONT : `email_enqueue()`, seul chemin d&apos;écriture du
        journal, est réservée à `service_role` — un jeton de navigateur ne met rien en file, et
        c&apos;est ce qui empêche un formulaire de devenir un relais de courrier indésirable. La
        publicité a son pont (`admin_send_email_campaign`) ; les messages de service n&apos;en ont
        pas. Un bouton qui échouerait aurait été plus vite écrit, et aurait fait chercher la
        panne pendant une heure.
      </Notice>

      {echec !== null ? (
        <ReadFailure error={echec} />
      ) : gabarits.length === 0 ? (
        <EmptyState
          tone="unknown"
          title="Le catalogue des gabarits est vide"
          description="La table existe mais ne contient aucune ligne : la migration 0084 a été jouée en partie, ou ses insertions ont été annulées. Aucun message ne peut partir tant que son gabarit n'est pas au catalogue — la nature d'un message est une propriété du gabarit, imposée par une clé étrangère."
        />
      ) : (
        <div className="flex flex-col gap-5">
          <Panel
            title="Messages adressés aux entreprises Pro"
            description="Nos propres clients. Ce sont les seuls à qui Oasis Care écrit en son nom."
            count={versEntreprise.length}
          >
            <ul className="divide-y divide-line">
              {versEntreprise.map((gabarit) => (
                <Ligne key={gabarit.key} gabarit={gabarit} />
              ))}
            </ul>
          </Panel>

          <Panel
            title="Messages adressés aux clients des paysagistes"
            description="Ils partent depuis Oasis Care Pro, au nom du paysagiste. Oasis Admin n'en déclenche aucun, et n'en lit pas le contenu."
            count={versClientFinal.length}
          >
            <ul className="divide-y divide-line">
              {versClientFinal.map((gabarit) => (
                <Ligne key={gabarit.key} gabarit={gabarit} />
              ))}
            </ul>
          </Panel>
        </div>
      )}

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <p className="eyebrow">Ce qu&apos;il faudrait pour la bienvenue et les paramètres</p>
          <p className="mt-2 text-[var(--text-body)] leading-relaxed text-ink-soft">
            Une fonction du même genre que celle des annonces —
            <code className="mx-1 rounded bg-surface-sunken px-1.5 py-0.5 font-mono text-[11px]">
              admin_send_service_email(entreprise, gabarit, motif, variables)
            </code>
            — restreinte aux gabarits dont l&apos;audience est « entreprise » et la nature
            « transactionnel », écrivant son motif dans le journal des actions administratives,
            derrière une permission neuve semée EXPLICITEMENT pour le super-administrateur. Sans
            ce semis explicite, la permission ne serait portée par personne et l&apos;écran
            disparaîtrait sans erreur : ce piège a déjà mordu trois fois dans ce projet.
          </p>
        </Card>

        <Card className="p-4">
          <p className="eyebrow">Et une nuance qui n&apos;est pas un détail</p>
          <p className="mt-2 text-[var(--text-body)] leading-relaxed text-ink-soft">
            La bienvenue part déjà toute seule, sur un changement d&apos;état. Un bouton
            « envoyer la bienvenue » ici en ferait une SECONDE source pour le même message. Ce
            qu&apos;il faut est un geste de RATTRAPAGE — pour l&apos;entreprise que le déclencheur
            a manquée — et non un second chemin ordinaire. La base l&apos;empêche déjà de partir
            deux fois : la clé d&apos;idempotence de `email_messages` est une colonne générée sous
            contrainte d&apos;unicité, que l&apos;appelant ne peut pas inventer. Mais l&apos;écran
            doit dire ce qu&apos;il est, sans quoi quelqu&apos;un s&apos;en servira comme d&apos;un
            envoi ordinaire et s&apos;étonnera qu&apos;il ne reparte pas.
          </p>
        </Card>
      </div>

      <Panel className="mt-5" title="L'IA n'envoie rien, et n'a pas de case pour le faire">
        <div className="px-4 py-3 text-[var(--text-body)] leading-relaxed text-ink-soft">
          Le catalogue des gabarits déclare trois déclencheurs : un humain clique, un fait daté
          vient d&apos;être posé, une échéance arrive. Il n&apos;y a PAS de valeur « IA ». Un
          envoi décidé par un modèle ne peut donc pas être déclaré, et ce qui ne peut pas être
          déclaré ne peut pas exister — la règle du produit (l&apos;IA prépare des brouillons, un
          humain valide) est ici traduite par une énumération qui n&apos;a pas de case pour elle,
          plutôt que par une consigne qu&apos;on peut oublier de suivre.
          <br />
          <br />
          À ne pas confondre avec l&apos;envoi automatique sur changement d&apos;état — « la
          facture vient d&apos;être émise, on l&apos;expédie » — qui est légitime, demandé, et
          n&apos;a rien à voir : c&apos;est un fait daté qui déclenche, pas un modèle qui décide.
        </div>
      </Panel>
    </>
  );
}
