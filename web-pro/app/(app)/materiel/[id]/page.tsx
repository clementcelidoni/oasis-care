import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrganization } from "@/lib/auth/organization";
import {
  PageHeader, Panel, InfoCard, EmptyState, Badge, StatusBadge,
  Field, SelectField, SubmitButton, Modal, ConfirmDialog,
} from "@/components/ui";
import { formatCents, centsToInput } from "@/lib/quotes/types";
import { formatDate } from "@/lib/crm/types";
import {
  EQUIPMENT_CATEGORIES, EQUIPMENT_CATEGORY_LABELS,
  EQUIPMENT_STATUSES, EQUIPMENT_STATUS_LABELS, EQUIPMENT_STATUS_TONE,
  OWNERSHIPS, OWNERSHIP_LABELS, METER_KINDS, METER_KIND_LABELS, METER_UNITS,
  MAINTENANCE_KINDS, MAINTENANCE_KIND_LABELS,
  DEADLINE_STATE_TONE, DEADLINE_STATE_LABELS,
  deadlineTitle, formatDelay, formatMeter,
  type EquipmentOverview, type EquipmentDueDate,
  type EquipmentMaintenance, type EquipmentAssignment,
} from "@/lib/equipment/types";
import {
  updateEquipment, archiveEquipment, restoreEquipment,
  completeDeadline, deleteDeadline,
  assignEquipment, returnEquipment,
  addMaintenance, deleteMaintenance,
} from "@/lib/equipment/actions";
import { DeadlineForm } from "./DeadlineForm";

/**
 * §5 GESTION → MATÉRIEL — la fiche d'un engin.
 *
 * L'ORDRE DES PANNEAUX EST L'ORDRE DES QUESTIONS qu'on se pose en
 * ouvrant la fiche, et il n'est pas celui du schéma :
 *
 *   1. qu'est-ce qui expire dessus — la seule chose qui coûte de
 *      l'argent quand on l'ignore ;
 *   2. où il est aujourd'hui — la question du lundi matin ;
 *   3. ce qu'on lui a fait, et ce que ça a coûté ;
 *   4. son identité, tout en bas, qu'on ne consulte presque jamais et
 *      qu'on ne modifie qu'à la marge.
 *
 * Mettre la carte d'identité en tête, comme le ferait un formulaire
 * calqué sur la table, obligerait à faire défiler pour arriver à ce
 * qu'on est venu chercher.
 */

/** Combien d'interventions on déroule avant de s'arrêter. */
const ENTRETIENS_AFFICHES = 30;

export default async function EquipmentDetailPage({ params }: PageProps<"/materiel/[id]">) {
  const { id } = await params;
  const organization = await getActiveOrganization();
  if (!organization) return null;

  const supabase = await createClient();

  const [
    { data: ficheBrute },
    { data: echeancesBrutes },
    { data: entretiensBruts, count: entretiensCount },
    { data: affectationsBrutes },
    { data: chantiersBruts },
    { data: equipesBrutes },
    { data: salariesBruts },
    { data: fournisseursBruts },
  ] = await Promise.all([
    // §13 MULTI-ENTREPRISES : la RLS ouvre au demandeur TOUTES les
    // organisations dont il est membre. Le filtre sur l'organisation
    // active n'est donc pas une protection — c'est ce qui fait qu'un
    // matériel de l'autre société n'apparaisse pas sous l'en-tête de
    // celle-ci, et qu'il ressorte en 404 tant qu'on n'a pas basculé.
    supabase
      .from("equipment_overview")
      .select("*")
      .eq("organization_id", organization.organizationId)
      .eq("equipment_id", id)
      .maybeSingle(),
    supabase
      .from("equipment_due_dates")
      .select("*")
      .eq("organization_id", organization.organizationId)
      .eq("equipment_id", id)
      .order("due_on", { ascending: true }),
    supabase
      .from("equipment_maintenance")
      .select("*", { count: "exact" })
      .eq("organization_id", organization.organizationId)
      .eq("equipment_id", id)
      .order("performed_on", { ascending: false })
      .limit(ENTRETIENS_AFFICHES),
    supabase
      .from("equipment_assignments")
      .select("*")
      .eq("organization_id", organization.organizationId)
      .eq("equipment_id", id)
      .order("started_on", { ascending: false })
      .limit(20),
    supabase
      .from("projects")
      .select("id, number, name")
      .eq("organization_id", organization.organizationId)
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("teams")
      .select("id, name")
      .eq("organization_id", organization.organizationId)
      .is("archived_at", null)
      .order("name"),
    supabase
      .from("employees")
      .select("id, first_name, last_name")
      .eq("organization_id", organization.organizationId)
      .is("archived_at", null)
      .order("last_name"),
    supabase
      .from("suppliers")
      .select("id, name")
      .eq("organization_id", organization.organizationId)
      .is("archived_at", null)
      .order("name"),
  ]);

  // La vue n'expose que les matériels de l'entreprise active : une
  // fiche d'ailleurs ressort vide, et c'est un 404, pas une erreur.
  if (!ficheBrute) notFound();
  const fiche = ficheBrute as unknown as EquipmentOverview;

  const echeances = (echeancesBrutes ?? []) as unknown as EquipmentDueDate[];
  const entretiens = (entretiensBruts ?? []) as unknown as EquipmentMaintenance[];
  const affectations = (affectationsBrutes ?? []) as unknown as EquipmentAssignment[];
  const chantiers = (chantiersBruts ?? []) as unknown as {
    id: string; number: string; name: string;
  }[];
  const equipes = (equipesBrutes ?? []) as unknown as { id: string; name: string }[];
  const salaries = (salariesBruts ?? []) as unknown as {
    id: string; first_name: string; last_name: string;
  }[];
  const fournisseurs = (fournisseursBruts ?? []) as unknown as { id: string; name: string }[];

  const peutModifier = organization.permissions.includes("projects.manage");
  const archive = fiche.archived_at !== null;

  const ouvertes = echeances.filter((e) => e.completed_on === null);
  const honorees = echeances.filter((e) => e.completed_on !== null);
  const enCours = affectations.find((a) => a.ended_on === null) ?? null;

  /**
   * Les destinataires cités par l'HISTORIQUE mais absents des listes
   * proposées au formulaire.
   *
   * Les trois listes ci-dessus n'offrent que ce qui est actif — on ne
   * propose pas d'envoyer la mini-pelle sur un chantier archivé. Mais
   * l'historique, lui, cite ce qui existait à l'époque : sans cette
   * seconde lecture, une affectation de l'an dernier s'afficherait
   * « Chantier supprimé » alors que le chantier est simplement terminé.
   * Une erreur d'affichage de ce genre fait douter de tout le reste du
   * journal.
   *
   * Le coût est nul dans le cas courant : la requête n'est posée que
   * s'il manque réellement quelque chose.
   */
  const absents = <T extends { id: string }>(
    connus: T[],
    ids: (string | null)[],
  ): string[] => [
    ...new Set(
      ids.filter((v): v is string => v !== null && !connus.some((c) => c.id === v)),
    ),
  ];

  const chantiersAbsents = absents(chantiers, affectations.map((a) => a.project_id));
  const equipesAbsentes = absents(equipes, affectations.map((a) => a.team_id));
  const salariesAbsents = absents(salaries, affectations.map((a) => a.employee_id));

  const [chantiersAnciens, equipesAnciennes, salariesAnciens] = await Promise.all([
    chantiersAbsents.length
      ? supabase
          .from("projects")
          .select("id, number, name")
          .eq("organization_id", organization.organizationId)
          .in("id", chantiersAbsents)
          .then((r) => r.data)
      : Promise.resolve(null),
    equipesAbsentes.length
      ? supabase
          .from("teams")
          .select("id, name")
          .eq("organization_id", organization.organizationId)
          .in("id", equipesAbsentes)
          .then((r) => r.data)
      : Promise.resolve(null),
    salariesAbsents.length
      ? supabase
          .from("employees")
          .select("id, first_name, last_name")
          .eq("organization_id", organization.organizationId)
          .in("id", salariesAbsents)
          .then((r) => r.data)
      : Promise.resolve(null),
  ]);

  const tousChantiers = [
    ...chantiers,
    ...((chantiersAnciens ?? []) as unknown as { id: string; number: string; name: string }[]),
  ];
  const toutesEquipes = [
    ...equipes,
    ...((equipesAnciennes ?? []) as unknown as { id: string; name: string }[]),
  ];
  const tousSalaries = [
    ...salaries,
    ...((salariesAnciens ?? []) as unknown as {
      id: string; first_name: string; last_name: string;
    }[]),
  ];

  /**
   * Le nom d'un destinataire d'affectation.
   *
   * « Supprimé » n'est employé que lorsque la ligne est réellement
   * introuvable — la clé est en `on delete set null`, donc ce cas
   * n'arrive que si l'identifiant subsiste sans sa ligne.
   */
  const nomDe = (a: EquipmentAssignment): string => {
    if (a.project_id) {
      const chantier = tousChantiers.find((c) => c.id === a.project_id);
      return chantier ? `Chantier ${chantier.name || chantier.number}` : "Chantier supprimé";
    }
    if (a.team_id) {
      const equipe = toutesEquipes.find((t) => t.id === a.team_id);
      return equipe ? `Équipe ${equipe.name}` : "Équipe supprimée";
    }
    if (a.employee_id) {
      const salarie = tousSalaries.find((s) => s.id === a.employee_id);
      return salarie ? `${salarie.first_name} ${salarie.last_name}`.trim() : "Salarié supprimé";
    }
    return "Destinataire inconnu";
  };

  const nomFournisseur = (idFournisseur: string | null): string | null =>
    idFournisseur ? (fournisseurs.find((f) => f.id === idFournisseur)?.name ?? null) : null;

  const unite = METER_UNITS[fiche.meter_kind];

  /**
   * Les deux formulaires modaux, décrits une fois et RENDUS DEUX FOIS :
   * dans l'entête de leur panneau, et dans son état vide.
   *
   * §32 demande que l'état vide porte « le bouton pour commencer ».
   * Renvoyer l'utilisateur vers un bouton situé plus haut, à droite,
   * en petit, revient à lui dire de se débrouiller. Deux rendus du même
   * élément produisent deux instances indépendantes — chacune avec sa
   * propre boîte de dialogue — et une seule description à maintenir.
   */
  const formulaireAffectation =
    peutModifier && !archive ? (
      <Modal
        triggerLabel={enCours ? "Déplacer" : "Affecter"}
        triggerVariant="secondary"
        title="Affecter ce matériel"
        description={
          enCours
            ? "L'affectation en cours sera close aujourd'hui, et la nouvelle ouverte à la même date : un engin ne peut pas être à deux endroits le même jour."
            : "À un chantier, à une équipe ou à un salarié."
        }
        width="30rem"
      >
        <form action={assignEquipment} className="flex flex-col gap-4">
          <input type="hidden" name="equipment_id" value={fiche.equipment_id} />
          <SelectField
            label="Chantier"
            name="project_id"
            defaultValue=""
            options={[
              { value: "", label: "— Aucun —" },
              ...chantiers.map((c) => ({ value: c.id, label: `${c.number} ${c.name}`.trim() })),
            ]}
          />
          <SelectField
            label="Équipe"
            name="team_id"
            defaultValue=""
            options={[
              { value: "", label: "— Aucune —" },
              ...equipes.map((t) => ({ value: t.id, label: t.name })),
            ]}
          />
          <SelectField
            label="Salarié"
            name="employee_id"
            defaultValue=""
            options={[
              { value: "", label: "— Aucun —" },
              ...salaries.map((s) => ({
                value: s.id,
                label: `${s.first_name} ${s.last_name}`.trim(),
              })),
            ]}
            hint="Renseignez-en au moins un. Les trois peuvent l'être : la mini-pelle est au chantier X, confiée à l'équipe Y."
          />
          <Field label="Note" name="notes" placeholder="Jusqu'à la fin du terrassement" />
          <div className="flex justify-end">
            <SubmitButton>Affecter</SubmitButton>
          </div>
        </form>
      </Modal>
    ) : undefined;

  const formulaireEntretien = peutModifier ? (
    <Modal
      triggerLabel="Noter une intervention"
      triggerVariant="secondary"
      title="Nouvelle intervention"
      description="Une révision, une réparation, un jeu de lames — ou un simple relevé de compteur."
      width="32rem"
    >
      <form action={addMaintenance} className="flex flex-col gap-4">
        <input type="hidden" name="equipment_id" value={fiche.equipment_id} />
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            label="Nature"
            name="kind"
            defaultValue="service"
            options={MAINTENANCE_KINDS.map((k) => ({
              value: k,
              label: MAINTENANCE_KIND_LABELS[k],
            }))}
          />
          <Field label="Effectuée le" name="performed_on" type="date" hint="Vide = aujourd'hui." />
          <Field
            label="Coût (€)"
            name="cost"
            placeholder="0,00"
            hint="0 est une valeur : une révision sous garantie coûte réellement zéro."
          />
          <Field
            label={unite ? `Compteur (${unite})` : "Compteur"}
            name="meter_reading"
            hint={
              fiche.meter_kind === "none"
                ? "Ce matériel n'a pas de compteur déclaré."
                : "Vide si vous ne l'avez pas relevé. Surtout pas 0."
            }
          />
          <SelectField
            label="Fournisseur"
            name="supplier_id"
            defaultValue=""
            options={[
              { value: "", label: "— Aucun —" },
              ...fournisseurs.map((f) => ({ value: f.id, label: f.name })),
            ]}
          />
          <SelectField
            label="Échéance honorée"
            name="deadline_id"
            defaultValue=""
            options={[
              { value: "", label: "— Aucune —" },
              ...ouvertes.map((e) => ({
                value: e.deadline_id,
                label: `${deadlineTitle(e.kind, e.label)} — ${formatDate(e.due_on)}`,
              })),
            ]}
            hint="Relie la facture à la date. Marquez ensuite l'échéance « faite » pour poser la suivante."
          />
        </div>
        <Field label="Description" name="description" placeholder="Vidange + filtres" />
        <div className="flex justify-end">
          <SubmitButton>Enregistrer</SubmitButton>
        </div>
      </form>
    </Modal>
  ) : undefined;

  return (
    <div className="mx-auto max-w-5xl px-8 py-10">
      <PageHeader
        breadcrumb={{ label: "Matériel", href: "/materiel" }}
        eyebrow={EQUIPMENT_CATEGORY_LABELS[fiche.category]}
        title={fiche.name}
        subtitle={
          [fiche.brand, fiche.model].filter(Boolean).join(" ") ||
          "Aucune marque ni modèle renseignés."
        }
        action={
          <>
            {fiche.internal_number && (
              <Badge tone="neutral">N° {fiche.internal_number}</Badge>
            )}
            {fiche.registration && <Badge tone="neutral">{fiche.registration}</Badge>}
            <Badge tone={archive ? "neutral" : EQUIPMENT_STATUS_TONE[fiche.status]}>
              {archive ? "Archivé" : EQUIPMENT_STATUS_LABELS[fiche.status]}
            </Badge>
          </>
        }
      />

      {archive && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] border border-line bg-surface-sunken px-5 py-4">
          <p className="text-[var(--text-body)] text-ink-soft">
            Ce matériel est sorti du parc. Son journal reste consultable, mais ses échéances
            ne sont plus surveillées.
          </p>
          {peutModifier && (
            <form action={restoreEquipment}>
              <input type="hidden" name="id" value={fiche.equipment_id} />
              <SubmitButton variant="secondary">Remettre au parc</SubmitButton>
            </form>
          )}
        </div>
      )}

      {/* Les quatre chiffres qu'on vient chercher, avant tout panneau. */}
      <section className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <InfoCard
          label="Prochaine échéance"
          value={
            fiche.next_due_on && fiche.next_due_kind ? (
              <span>
                {formatDelay(fiche.next_due_days_left)}
                <span className="block text-[var(--text-secondary)] font-normal text-ink-soft">
                  {deadlineTitle(fiche.next_due_kind, null)} · {formatDate(fiche.next_due_on)}
                </span>
              </span>
            ) : (
              <span className="text-ink-faint">Aucune</span>
            )
          }
          badge={
            fiche.next_due_state
              ? {
                  label: DEADLINE_STATE_LABELS[fiche.next_due_state],
                  tone: DEADLINE_STATE_TONE[fiche.next_due_state],
                }
              : undefined
          }
          hint={
            fiche.next_due_on
              ? undefined
              : "Rien n'est surveillé sur ce matériel : aucune alerte ne partira."
          }
        />
        <InfoCard
          label="Compteur"
          value={
            /* NULL n'est pas zéro : « jamais relevé » et « n'a jamais
               tourné » sont deux affirmations différentes, et l'une des
               deux est fausse. */
            fiche.current_meter === null ? (
              <span className="text-ink-faint">—</span>
            ) : (
              <span className="tabular">{formatMeter(fiche.current_meter, fiche.meter_kind)}</span>
            )
          }
          hint={
            fiche.meter_kind === "none"
              ? "Ce matériel n'a pas de compteur."
              : fiche.meter_read_on
                ? `Relevé le ${formatDate(fiche.meter_read_on)}`
                : "Jamais relevé. Le compteur se remplit depuis le journal d'entretien."
          }
        />
        <InfoCard
          label="Où il est"
          value={
            enCours ? (
              nomDe(enCours)
            ) : (
              <span className="text-ink-faint">Au dépôt</span>
            )
          }
          hint={enCours ? `Depuis le ${formatDate(enCours.started_on)}` : undefined}
        />
        <InfoCard
          label="Entretien"
          value={
            /* Un journal vide ne prouve pas qu'on n'a rien dépensé : il
               prouve qu'on n'a rien noté. D'où le tiret. */
            <span className="tabular">
              {fiche.maintenance_cost_cents === null
                ? "—"
                : formatCents(fiche.maintenance_cost_cents)}
            </span>
          }
          hint={
            fiche.maintenance_count > 0
              ? `${fiche.maintenance_count} intervention${fiche.maintenance_count > 1 ? "s" : ""} enregistrée${fiche.maintenance_count > 1 ? "s" : ""}`
              : "Aucune intervention notée"
          }
        />
      </section>

      {/* ---------------------------------------------------------
          1. Les échéances
          --------------------------------------------------------- */}
      <Panel
        title="Échéances"
        description="Ce qui expire, et ce qui coûte cher quand on l'oublie."
        className="mb-6"
        count={ouvertes.length}
        action={peutModifier && !archive ? <DeadlineForm equipmentId={fiche.equipment_id} /> : undefined}
      >
        {ouvertes.length === 0 && honorees.length === 0 ? (
          <div className="px-5 py-5">
            {/* §32 — ce qu'il n'y a pas, à quoi ça servira, et le bouton
                pour commencer. C'est l'état vide le plus important du
                module : un matériel sans échéance ne déclenchera jamais
                rien, et c'est exactement celui qu'on oublie. */}
            <EmptyState
              title="Aucune échéance surveillée"
              description="Posez le contrôle technique, l'assurance, la révision ou la vérification réglementaire de ce matériel. Il remontera de lui-même en tête de la liste au moment voulu, sans que personne n'ait à y penser."
              action={
                peutModifier && !archive ? (
                  <DeadlineForm equipmentId={fiche.equipment_id} />
                ) : undefined
              }
            />
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {[...ouvertes, ...honorees].map((echeance) => (
              <li
                key={echeance.deadline_id}
                className="flex flex-wrap items-start justify-between gap-3 px-5 py-3.5"
              >
                <div className="min-w-0">
                  <p className="font-medium">{deadlineTitle(echeance.kind, echeance.label)}</p>
                  <p className="text-[var(--text-secondary)] text-ink-soft">
                    {echeance.completed_on
                      ? `Honorée le ${formatDate(echeance.completed_on)} · échéait le ${formatDate(echeance.due_on)}`
                      : `${formatDate(echeance.due_on)} · préavis de ${echeance.reminder_days} jour${echeance.reminder_days > 1 ? "s" : ""}${
                          echeance.recurrence_months
                            ? ` · tous les ${echeance.recurrence_months} mois`
                            : ""
                        }`}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <StatusBadge tone={DEADLINE_STATE_TONE[echeance.state]}>
                    {echeance.completed_on
                      ? DEADLINE_STATE_LABELS.done
                      : formatDelay(echeance.days_left)}
                  </StatusBadge>
                  {peutModifier && !echeance.completed_on && (
                    <Modal
                      triggerLabel="Marquer faite"
                      triggerVariant="secondary"
                      title={deadlineTitle(echeance.kind, echeance.label)}
                      description={
                        echeance.recurrence_months
                          ? `La suivante sera posée automatiquement, ${echeance.recurrence_months} mois après la date réellement effectuée — pas après l'ancienne échéance.`
                          : "Cette échéance est ponctuelle : rien ne sera reposé après elle."
                      }
                      width="26rem"
                    >
                      <form action={completeDeadline} className="flex flex-col gap-4">
                        <input type="hidden" name="deadline_id" value={echeance.deadline_id} />
                        <input type="hidden" name="equipment_id" value={fiche.equipment_id} />
                        <Field
                          label="Effectuée le"
                          name="completed_on"
                          type="date"
                          hint="Vide = aujourd'hui."
                        />
                        <Field
                          label="Coût (€)"
                          name="completed_cost"
                          placeholder="0,00"
                          hint="Facultatif. Vide reste inconnu, ce qui n'est pas la même chose que gratuit."
                        />
                        <Field label="Note" name="completed_note" />
                        <div className="flex justify-end">
                          <SubmitButton>Enregistrer</SubmitButton>
                        </div>
                      </form>
                    </Modal>
                  )}
                  {peutModifier && (
                    <ConfirmDialog
                      triggerLabel="✕"
                      triggerTitle="Supprimer cette échéance"
                      triggerVariant="ghost"
                      title="Supprimer cette échéance ?"
                      message="À n'utiliser que pour une échéance saisie par erreur. Une échéance réellement passée se marque « faite » : c'est ce qui garde la trace du contrôle et pose le suivant."
                      confirmLabel="Supprimer"
                      confirmVariant="danger"
                      action={deleteDeadline}
                      hidden={{
                        deadline_id: echeance.deadline_id,
                        equipment_id: fiche.equipment_id,
                      }}
                    />
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {/* ---------------------------------------------------------
          2. L'affectation
          --------------------------------------------------------- */}
      <Panel
        title="Affectation"
        description="Où se trouve ce matériel, et où il est passé."
        className="mb-6"
        action={
          peutModifier && !archive ? (
            <div className="flex items-center gap-2">
              {enCours && (
                <form action={returnEquipment}>
                  <input type="hidden" name="equipment_id" value={fiche.equipment_id} />
                  <SubmitButton variant="ghost">Rentrer au dépôt</SubmitButton>
                </form>
              )}
              {formulaireAffectation}
            </div>
          ) : undefined
        }
      >
        {affectations.length === 0 ? (
          <div className="px-5 py-5">
            <EmptyState
              title="Jamais affecté"
              description="Indiquez à quel chantier ou à quelle équipe ce matériel est confié. La question se pose le lundi matin, quand personne ne sait où est la mini-pelle."
              action={formulaireAffectation}
            />
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {affectations.map((affectation) => (
              <li
                key={affectation.id}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
              >
                <div className="min-w-0">
                  <p className="font-medium">{nomDe(affectation)}</p>
                  <p className="text-[var(--text-secondary)] text-ink-soft">
                    Du {formatDate(affectation.started_on)}
                    {affectation.ended_on ? ` au ${formatDate(affectation.ended_on)}` : ""}
                    {affectation.notes ? ` · ${affectation.notes}` : ""}
                  </p>
                </div>
                {affectation.ended_on === null && <Badge tone="accent">En cours</Badge>}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {/* ---------------------------------------------------------
          3. L'entretien
          --------------------------------------------------------- */}
      <Panel
        title="Journal d'entretien"
        description="Ce qu'on a fait, ce que ça a coûté, et le compteur ce jour-là."
        className="mb-6"
        count={fiche.maintenance_count}
        action={formulaireEntretien}
        footer={
          (entretiensCount ?? 0) > entretiens.length ? (
            <span className="text-[var(--text-secondary)] text-ink-soft">
              Les {entretiens.length} interventions les plus récentes sur {entretiensCount}.
            </span>
          ) : undefined
        }
      >
        {entretiens.length === 0 ? (
          <div className="px-5 py-5">
            <EmptyState
              title="Aucune intervention notée"
              description="Notez les révisions, les réparations et les relevés de compteur. C'est ce journal qui dit ce que cette machine coûte réellement à l'année — et qui remplit son compteur."
              action={formulaireEntretien}
            />
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {entretiens.map((intervention) => (
              <li
                key={intervention.id}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
              >
                <div className="min-w-0">
                  <p className="font-medium">
                    {MAINTENANCE_KIND_LABELS[intervention.kind]}
                    {intervention.description && (
                      <span className="font-normal text-ink-soft"> — {intervention.description}</span>
                    )}
                  </p>
                  <p className="text-[var(--text-secondary)] text-ink-soft">
                    {formatDate(intervention.performed_on)}
                    {intervention.meter_reading !== null &&
                      ` · ${formatMeter(intervention.meter_reading, fiche.meter_kind)}`}
                    {nomFournisseur(intervention.supplier_id) &&
                      ` · ${nomFournisseur(intervention.supplier_id)}`}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="tabular text-[var(--text-body)]">
                    {formatCents(intervention.cost_cents)}
                  </span>
                  {peutModifier && (
                    <ConfirmDialog
                      triggerLabel="✕"
                      triggerTitle="Supprimer cette intervention"
                      triggerVariant="ghost"
                      title="Supprimer cette intervention ?"
                      message="Le coût total et le compteur affichés plus haut se recalculent aussitôt : ils ne sont stockés nulle part, ils se lisent depuis ce journal."
                      confirmLabel="Supprimer"
                      confirmVariant="danger"
                      action={deleteMaintenance}
                      hidden={{
                        maintenance_id: intervention.id,
                        equipment_id: fiche.equipment_id,
                      }}
                    />
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {/* ---------------------------------------------------------
          4. L'identité, tout en bas
          --------------------------------------------------------- */}
      <form action={updateEquipment}>
        {/* HORS du `fieldset disabled` ci-dessous, et ce n'est pas un
            détail de placement : un `fieldset` désactivé n'envoie AUCUN
            de ses champs, champs cachés compris. À l'intérieur, cet
            identifiant disparaîtrait du formulaire et l'action ne
            saurait plus quel matériel enregistrer. */}
        <input type="hidden" name="id" value={fiche.equipment_id} />
        <Panel
          title="Identité et propriété"
          description="Ce qu'on consulte rarement, et qu'on corrige à la marge."
          footer={
            peutModifier ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <SubmitButton variant="secondary">Enregistrer</SubmitButton>
                {!archive && (
                  <ConfirmDialog
                    triggerLabel="Sortir du parc"
                    triggerVariant="ghost"
                    title="Archiver ce matériel ?"
                    message="Il disparaît du parc et ses échéances cessent de sonner — relancer sur le contrôle technique d'un camion vendu ferait douter de toutes les autres alertes. Son journal d'entretien, lui, reste consultable."
                    confirmLabel="Archiver"
                    confirmVariant="danger"
                    action={archiveEquipment}
                    hidden={{ id: fiche.equipment_id }}
                  />
                )}
              </div>
            ) : undefined
          }
        >
          <fieldset disabled={!peutModifier} className="grid gap-4 px-5 py-5 sm:grid-cols-2">
            <Field label="Nom" name="name" required defaultValue={fiche.name} />
            <SelectField
              label="Catégorie"
              name="category"
              defaultValue={fiche.category}
              options={EQUIPMENT_CATEGORIES.map((c) => ({
                value: c,
                label: EQUIPMENT_CATEGORY_LABELS[c],
              }))}
            />
            <Field label="Marque" name="brand" defaultValue={fiche.brand ?? ""} />
            <Field label="Modèle" name="model" defaultValue={fiche.model ?? ""} />
            <Field
              label="Numéro de série"
              name="serial_number"
              defaultValue={fiche.serial_number ?? ""}
            />
            <Field
              label="Numéro interne"
              name="internal_number"
              defaultValue={fiche.internal_number ?? ""}
              hint="Deux engins ne peuvent pas porter le même."
            />
            <Field
              label="Immatriculation"
              name="registration"
              defaultValue={fiche.registration ?? ""}
              placeholder="AB-123-CD"
            />
            <SelectField
              label="État"
              name="status"
              defaultValue={fiche.status}
              options={EQUIPMENT_STATUSES.map((s) => ({
                value: s,
                label: EQUIPMENT_STATUS_LABELS[s],
              }))}
            />

            <SelectField
              label="Propriété"
              name="ownership"
              defaultValue={fiche.ownership}
              options={OWNERSHIPS.map((o) => ({ value: o, label: OWNERSHIP_LABELS[o] }))}
            />
            <Field
              label="Date d'acquisition"
              name="acquired_on"
              type="date"
              defaultValue={fiche.acquired_on ?? ""}
            />
            <Field
              label="Coût d'acquisition (€)"
              name="acquisition_cost"
              defaultValue={centsToInput(fiche.acquisition_cost_cents)}
              hint="Vide reste inconnu. Ce module ne calcule aucun amortissement : c'est le métier de l'expert-comptable."
            />
            <SelectField
              label="Fournisseur"
              name="supplier_id"
              defaultValue={fiche.supplier_id ?? ""}
              options={[
                { value: "", label: "— Aucun —" },
                ...fournisseurs.map((f) => ({ value: f.id, label: f.name })),
              ]}
            />
            <SelectField
              label="Compteur"
              name="meter_kind"
              defaultValue={fiche.meter_kind}
              options={METER_KINDS.map((m) => ({ value: m, label: METER_KIND_LABELS[m] }))}
              hint="Sa valeur ne se saisit pas ici : elle se lit dans le journal d'entretien."
            />

            <label className="flex flex-col gap-1.5 sm:col-span-2">
              <span className="text-[var(--text-secondary)] font-medium text-ink-soft">Notes</span>
              <textarea
                name="notes"
                rows={2}
                defaultValue={fiche.notes ?? ""}
                placeholder="Clé de contact au bureau, attelage 3,5 t…"
                className="rounded-[var(--radius-control)] border border-line-strong bg-surface px-3 py-2 text-[var(--text-body)] outline-none placeholder:text-ink-faint focus:border-accent"
              />
            </label>
          </fieldset>
        </Panel>
      </form>
    </div>
  );
}
