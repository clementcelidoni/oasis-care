import type { ReactNode } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrganization } from "@/lib/auth/organization";
import { MODULE_LABELS, TOGGLEABLE_MODULES } from "@/lib/navigation";
import { PageHeader, Panel, ButtonLink } from "@/components/ui";
import { Icon, type IconName } from "@/components/shell/Icon";

/**
 * §17 MENU PROFIL → « Aide ».
 *
 * Ce que cette page n'est pas : une liste de fonctionnalités. Un
 * paysagiste qui l'ouvre ne cherche pas à savoir ce que le logiciel
 * sait faire, il cherche à finir une chose qu'il a commencée — inviter
 * un client, retrouver un devis, comprendre pourquoi un menu a disparu.
 * D'où sept sections écrites comme des réponses, chacune avec son
 * ancre, et un sommaire qui sert de table des matières.
 *
 * §1 : de grandes cartes, une idée par carte. Rien n'est expliqué en
 * termes de base de données, de rôle technique ou de « module » quand
 * un mot du métier suffit.
 *
 * Tout ce qui est décrit ici existe vraiment dans l'application. Quand
 * quelque chose manque encore — l'envoi automatique des invitations —
 * c'est écrit noir sur blanc : une aide qui promet plus que le produit
 * fait perdre plus de temps qu'elle n'en fait gagner.
 */

const SECTIONS: { id: string; label: string }[] = [
  { id: "recherche", label: "Retrouver n'importe quoi" },
  { id: "portail", label: "Ouvrir le portail à un client" },
  { id: "jardin", label: "Livrer un jardin" },
  { id: "societe", label: "SIRET, logo et en-tête des documents" },
  { id: "modules", label: "Éteindre un module inutile" },
  { id: "ia", label: "Oasis AI, et ce qu'il ne fait pas" },
  { id: "contact", label: "Nous contacter" },
];

export default async function HelpPage() {
  const organization = await getActiveOrganization();

  // §"Nous contacter" — l'adresse de l'entreprise, si elle est
  // renseignée. On ne fabrique pas d'adresse de support : il n'y en a
  // pas, et en inventer une enverrait des messages dans le vide.
  const supabase = await createClient();
  const { data: company } = organization
    ? await supabase
        .from("business_organizations")
        .select("email, phone, website")
        .eq("id", organization.organizationId)
        .maybeSingle()
    : { data: null };

  return (
    <div className="mx-auto max-w-3xl px-8 py-10">
      <PageHeader
        title="Aide"
        subtitle="Les sept questions qui reviennent le plus, répondues en français, sans jargon."
      />

      {/* Un sommaire d'ancres plutôt qu'un menu latéral : la page tient
          en un écran et demi de défilement, et un lecteur d'écran
          annonce la liste des sujets en une fois. */}
      <nav aria-label="Sommaire" className="mb-8">
        <ul className="flex flex-wrap gap-2">
          {SECTIONS.map((section) => (
            <li key={section.id}>
              <a
                href={`#${section.id}`}
                className="inline-flex rounded-[var(--radius-pill)] border border-line bg-surface px-3 py-1.5 text-[var(--text-secondary)] text-ink-soft transition-colors hover:border-line-strong hover:text-ink"
              >
                {section.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <Section
        id="recherche"
        icon="search"
        title="Retrouver n'importe quoi"
        description="Un client, un devis, une facture, un chantier, une plante."
      >
        <p>
          En haut de l&apos;écran, il y a une barre de recherche. Elle cherche
          dans <strong className="font-medium text-ink">tout</strong> à la fois :
          vos clients, vos prospects, vos devis, vos factures, vos chantiers,
          votre catalogue, vos lots de pépinière. Pas besoin de choisir un menu
          avant de chercher.
        </p>
        <p>
          Le raccourci le plus utile du logiciel :{" "}
          <Key>Ctrl</Key> <span aria-hidden>+</span> <Key>K</Key> sur un PC,{" "}
          <Key>⌘</Key> <span aria-hidden>+</span> <Key>K</Key> sur un Mac. La
          recherche s&apos;ouvre où que vous soyez, même au milieu d&apos;un
          devis.
        </p>
        <ul className="ml-5 list-disc space-y-1.5">
          <li>
            Tapez trois lettres du nom. Les résultats se rangent par famille —
            clients d&apos;un côté, devis de l&apos;autre.
          </li>
          <li>
            Les flèches du clavier montent et descendent, <Key>Entrée</Key>{" "}
            ouvre la fiche directement.
          </li>
          <li>
            Tapez une intention plutôt qu&apos;un nom — « nouveau devis »,
            « nouveau client » — et la recherche propose de le créer.
          </li>
          <li>
            Ce que vous ouvrez souvent revient tout seul en haut de la liste, et
            l&apos;étoile épingle en favori ce que vous voulez garder sous la
            main.
          </li>
          <li>
            Trop de résultats ? « Voir tous les résultats » ouvre{" "}
            <InlineLink href="/recherche">la page de recherche</InlineLink>, où
            l&apos;on filtre par famille.
          </li>
          <li>
            Pour ceux qui aiment les raccourcis : <Code>type:devis Martin</Code>{" "}
            ne cherche que dans les devis. Ce n&apos;est jamais obligatoire — une
            recherche sans mot-clé cherche partout, et un mot inconnu reste du
            texte ordinaire.
          </li>
        </ul>
      </Section>

      <Section
        id="portail"
        icon="portal"
        title="Ouvrir le portail à un client"
        description="Lui donner accès à ses devis, ses factures et l'avancement de son chantier."
      >
        <ol className="ml-5 list-decimal space-y-1.5">
          <li>
            Ouvrez la fiche du client (menu <strong className="font-medium text-ink">Clients</strong>,
            ou la recherche).
          </li>
          <li>
            Descendez jusqu&apos;au bloc{" "}
            <strong className="font-medium text-ink">Portail client</strong>,
            vérifiez son adresse e-mail, et cliquez sur{" "}
            <strong className="font-medium text-ink">Créer l&apos;invitation</strong>.
          </li>
          <li>
            <strong className="font-medium text-ink">
              Copiez le lien qui s&apos;affiche et envoyez-le vous-même
            </strong>{" "}
            — par mail, par SMS, comme vous avez l&apos;habitude. Oasis Care Pro
            n&apos;envoie pas encore les invitations à votre place. Le lien a une
            date de validité, et il ouvre l&apos;accès aux documents de ce client :
            ne le publiez nulle part.
          </li>
          <li>
            Le client crée un compte Oasis Care gratuit avec ce lien. Le bloc
            passe alors sur <strong className="font-medium text-ink">Actif</strong>.
          </li>
        </ol>
        <p>
          Il voit ses devis, ses factures et l&apos;avancement de ses chantiers.
          Il ne voit{" "}
          <strong className="font-medium text-ink">
            ni vos coûts, ni vos marges, ni vos notes internes
          </strong>{" "}
          : ce n&apos;est pas une question de réglage, ces informations ne partent
          jamais vers son espace.
        </p>
        <p>
          « Fermer l&apos;accès au portail » lui retire la consultation quand la
          relation s&apos;arrête.
        </p>
      </Section>

      <Section
        id="jardin"
        icon="twin"
        title="Livrer un jardin"
        description="Faire passer le plan que vous avez dessiné dans l'application du client."
      >
        <p>
          Livrer un jardin, c&apos;est en{" "}
          <strong className="font-medium text-ink">donner la propriété</strong> à
          votre client : le plan arrive dans SON application Oasis Care, avec ses
          plantes, ses zones et son arrosage. Il devient le propriétaire du
          jardin ; vous gardez un accès pour continuer à l&apos;entretenir — accès
          qu&apos;il peut vous retirer, puisque le jardin est le sien.
        </p>
        <ol className="ml-5 list-decimal space-y-1.5">
          <li>
            Le client doit d&apos;abord avoir accepté son invitation au portail
            (voir juste au-dessus). Sans compte, il n&apos;y a personne à qui
            donner le jardin.
          </li>
          <li>
            Le jardin doit être rattaché à l&apos;une de ses propriétés, dans le
            bloc <strong className="font-medium text-ink">Propriétés</strong> de sa
            fiche.
          </li>
          <li>
            Dans le bloc <strong className="font-medium text-ink">Portail client</strong>,
            la liste « Livrer un jardin » apparaît. Un clic sur{" "}
            <strong className="font-medium text-ink">Livrer le jardin</strong>, et
            c&apos;est fait.
          </li>
        </ol>
        <p>
          Vos devis, vos coûts et vos marges ne bougent pas : ils restent chez
          vous. Et si vous fermez plus tard l&apos;accès au portail, les jardins
          déjà livrés{" "}
          <strong className="font-medium text-ink">restent la propriété du client</strong>{" "}
          — une livraison ne se reprend pas.
        </p>
      </Section>

      <Section
        id="societe"
        icon="company"
        title="SIRET, logo et en-tête des documents"
        description="Ce qui s'imprime en haut de vos devis et de vos factures."
      >
        <p>
          Tout se règle au même endroit :{" "}
          <strong className="font-medium text-ink">Ma société</strong>, dans le
          menu de votre avatar en haut à droite.
        </p>
        <ul className="ml-5 list-disc space-y-1.5">
          <li>
            <strong className="font-medium text-ink">Le logo</strong> se dépose en
            haut de la page. PNG, JPEG ou WebP ; il est réduit dans votre
            navigateur avant l&apos;envoi, vous pouvez donc y glisser la photo
            telle qu&apos;elle sort de votre appareil.
          </li>
          <li>
            <strong className="font-medium text-ink">SIREN, SIRET, TVA, RCS,
            forme juridique, capital</strong> sont dans le panneau « Identité ».
            Le SIRET est obligatoire sur un devis et sur une facture : tant
            qu&apos;il est vide, vos documents sortent incomplets.
          </li>
          <li>
            <strong className="font-medium text-ink">L&apos;adresse, le téléphone
            et l&apos;e-mail</strong> du panneau « Coordonnées » composent
            l&apos;en-tête, et c&apos;est ce que vos clients lisent dans leur
            portail.
          </li>
          <li>
            <strong className="font-medium text-ink">Les assurances</strong>{" "}
            (RC Pro, décennale) ont leur propre panneau. Attention à la
            distinction : les champs du haut servent à retrouver vos contrats,
            seule la phrase « Mention imprimée sur les devis et factures »
            figure réellement sur le document.
          </li>
        </ul>
        <p>
          Chaque panneau a son propre bouton{" "}
          <strong className="font-medium text-ink">Enregistrer</strong> : corriger
          un numéro de contrat n&apos;oblige pas à revalider l&apos;adresse du
          siège.
        </p>
        <p className="text-ink-faint">
          Seul un administrateur modifie ces informations. Si les champs sont
          grisés, c&apos;est que votre rôle est en lecture seule sur cette page —
          votre rôle est indiqué sur{" "}
          <InlineLink href="/profil">votre profil</InlineLink>.
        </p>
        <div className="pt-1">
          <ButtonLink href="/entreprise" variant="secondary">
            Ouvrir Ma société
          </ButtonLink>
        </div>
      </Section>

      <Section
        id="modules"
        icon="settings"
        title="Éteindre un module inutile"
        description="Faire disparaître du menu ce que votre métier n'utilise pas."
      >
        <p>
          Oasis Care Pro sert aussi bien un paysagiste qu&apos;un pépiniériste. Si
          vous ne produisez pas de végétaux, les écrans de pépinière
          n&apos;encombrent pas votre menu pour rien : ils s&apos;éteignent. Les
          modules débrayables sont{" "}
          {TOGGLEABLE_MODULES.map((key) => MODULE_LABELS[key]).join(", ")}.
        </p>
        <p>
          <strong className="font-medium text-ink">Éteindre un module ne
          supprime rien.</strong>{" "}
          C&apos;est du rangement, pas un droit : les données restent en base,
          les fiches existantes ne bougent pas, et rallumer le module les fait
          toutes réapparaître. À l&apos;inverse, éteindre « Facturation »
          n&apos;empêche personne d&apos;accéder à une facture par un lien
          direct : ce qui décide de qui voit quoi, c&apos;est le rôle, pas ce
          réglage.
        </p>
        <p>
          Le menu dépend aussi de votre{" "}
          <strong className="font-medium text-ink">activité</strong> (paysagiste,
          pépiniériste, les deux…) et de votre{" "}
          <strong className="font-medium text-ink">rôle</strong>. Un écran absent
          n&apos;est pas forcément éteint : il peut simplement ne pas concerner
          votre métier ou dépasser vos droits.
        </p>
        <div className="pt-1">
          <ButtonLink href="/parametres" variant="secondary">
            Ouvrir les préférences
          </ButtonLink>
        </div>
      </Section>

      <Section
        id="ia"
        icon="ai"
        title="Oasis AI, et ce qu'il ne fait pas"
        description="Un assistant qui lit vos données — pas un devin, pas un comptable."
      >
        <p>
          La page <strong className="font-medium text-ink">Oasis AI</strong>{" "}
          contient deux choses très différentes.
        </p>
        <p>
          <strong className="font-medium text-ink">Oasis Daily</strong>, en haut,
          est votre journée : les interventions du jour, les devis à relancer ou
          qui vont expirer, les factures en retard, les chantiers qui débordent,
          les pointages à valider, les réceptions attendues. Ce n&apos;est{" "}
          <strong className="font-medium text-ink">pas</strong> une intelligence
          artificielle : ce sont vos propres dates, lues telles quelles. Aucune
          invention possible.
        </p>
        <p>
          <strong className="font-medium text-ink">L&apos;assistant</strong>, en
          dessous, répond à des questions qui demandent de croiser plusieurs
          écrans : « quels végétaux commander pour les chantiers signés ? ». Il
          lit les données de votre entreprise, et rien d&apos;autre.
        </p>
        <p className="font-medium text-ink">Ce qu&apos;il ne fait pas :</p>
        <ul className="ml-5 list-disc space-y-1.5">
          <li>
            Il n&apos;envoie rien. Il peut préparer un brouillon de devis, jamais
            l&apos;expédier à un client.
          </li>
          <li>
            Il ne décide pas à votre place, et ne modifie ni vos factures ni vos
            prix.
          </li>
          <li>
            Il ne sait que ce qui est saisi dans le logiciel. Ce que vous avez
            noté sur un carnet, il l&apos;ignore.
          </li>
          <li>
            Il peut se tromper.{" "}
            <strong className="font-medium text-ink">
              Relisez tout montant avant de vous engager dessus
            </strong>{" "}
            : les chiffres viennent de vos données, mais la phrase autour est
            écrite par une machine.
          </li>
        </ul>
        <div className="pt-1">
          <ButtonLink href="/oasis-ai" variant="secondary">
            Ouvrir Oasis AI
          </ButtonLink>
        </div>
      </Section>

      <Section
        id="contact"
        icon="help"
        title="Nous contacter"
        description="Quand la réponse n'est pas sur cette page."
      >
        {company?.email ? (
          <>
            <p>
              L&apos;adresse de contact de{" "}
              <strong className="font-medium text-ink">
                {organization?.name ?? "votre entreprise"}
              </strong>{" "}
              est{" "}
              <a
                href={`mailto:${company.email}`}
                className="text-accent underline underline-offset-2"
              >
                {company.email}
              </a>
              {company.phone ? <>, et son téléphone le {company.phone}</> : null}.
            </p>
            <p className="text-ink-faint">
              C&apos;est celle qui figure sur vos devis et dans le portail de vos
              clients. Elle se modifie dans{" "}
              <InlineLink href="/entreprise">Ma société</InlineLink>.
            </p>
          </>
        ) : (
          <>
            <p>
              Aucune adresse de contact n&apos;est renseignée pour{" "}
              <strong className="font-medium text-ink">
                {organization?.name ?? "votre entreprise"}
              </strong>
              . C&apos;est cette adresse qui s&apos;imprime sur vos devis et que
              vos clients voient dans leur portail : elle vaut la peine
              d&apos;être remplie.
            </p>
            <div className="pt-1">
              <ButtonLink href="/entreprise">Renseigner l&apos;adresse</ButtonLink>
            </div>
          </>
        )}
      </Section>
    </div>
  );
}

/**
 * Une section d'aide : un titre, une ancre, et du texte.
 *
 * L'ancre est portée par le `<section>` et non par le `Panel`, pour la
 * même raison que le sommaire existe : arriver sur `#jardin` doit poser
 * le titre en haut de l'écran, pas au milieu d'un paragraphe.
 */
function Section({
  id,
  icon,
  title,
  description,
  children,
}: {
  id: string;
  icon: IconName;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="mb-4 scroll-mt-6">
      <Panel
        title={title}
        description={description}
        action={<Icon name={icon} className="h-[18px] w-[18px] text-ink-faint" />}
      >
        <div className="flex flex-col gap-3 px-5 py-5 text-[var(--text-body)] text-ink-soft">
          {children}
        </div>
      </Panel>
    </section>
  );
}

/** Une touche du clavier, écrite comme on la voit sur le clavier. */
function Key({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded-[var(--radius-control)] border border-line-strong bg-surface-sunken px-1.5 py-0.5 text-[var(--text-secondary)] font-medium text-ink">
      {children}
    </kbd>
  );
}

/** Quelque chose à taper tel quel, distinct d'une touche du clavier. */
function Code({ children }: { children: ReactNode }) {
  return (
    <code className="rounded-[var(--radius-control)] bg-surface-sunken px-1.5 py-0.5 text-[var(--text-secondary)] text-ink">
      {children}
    </code>
  );
}

/** Un lien vers un écran de l'application, au fil du texte. */
function InlineLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="text-accent underline underline-offset-2">
      {children}
    </Link>
  );
}
