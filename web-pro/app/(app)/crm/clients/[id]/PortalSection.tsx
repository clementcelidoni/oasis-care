import { Card, Badge, SubmitButton } from "@/components/ui";
import { formatDate } from "@/lib/crm/types";
import {
  inviteClient, cancelInvitation, revokePortalAccess, deliverGarden,
} from "@/lib/portal/proActions";
import { InvitationLink } from "./InvitationLink";

export type PortalInvitation = {
  id: string;
  email: string;
  token: string;
  expires_at: string;
  created_at: string;
};

export type PortalAccess = {
  id: string;
  user_id: string;
  created_at: string;
};

export type DeliverableGarden = {
  id: string;
  name: string;
  siteName: string;
  deliveredAt: string | null;
};

/**
 * §11S côté professionnel — « Le client crée un compte Oasis Care
 * (gratuit) », et §JARDIN PRO → PARTICULIER.
 *
 * Trois états, un seul à la fois :
 *
 *  1. rien — un champ e-mail et un bouton ;
 *  2. invitation en attente — le lien à transmettre ;
 *  3. accès actif — et alors, et alors seulement, la livraison du
 *     jardin devient possible.
 *
 * L'ordre n'est pas cosmétique. `deliver_garden_to_client` a besoin du
 * COMPTE du client pour lui transférer le jardin : proposer « Livrer »
 * avant qu'il ait accepté l'invitation offrirait un bouton qui échoue à
 * tous les coups.
 */
export function PortalSection({
  customerId, customerEmail, invitation, access, gardens,
}: {
  customerId: string;
  customerEmail: string | null;
  invitation: PortalInvitation | null;
  access: PortalAccess | null;
  gardens: DeliverableGarden[];
}) {
  return (
    <Card>
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 className="text-sm font-semibold">Portail client</h2>
        {access ? (
          <Badge tone="accent">Actif</Badge>
        ) : invitation ? (
          <Badge tone="warning">Invitation envoyée</Badge>
        ) : (
          <Badge>Fermé</Badge>
        )}
      </div>

      {!access && !invitation && (
        <form action={inviteClient} className="px-4 py-3">
          <input type="hidden" name="customer_id" value={customerId} />
          <p className="mb-2.5 text-sm text-ink-soft">
            Donnez à ce client un accès en lecture à ses devis, ses factures et
            l&apos;avancement de ses chantiers. Il ne verra ni vos coûts, ni vos
            marges, ni vos notes.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <input
              name="email"
              type="email"
              required
              defaultValue={customerEmail ?? ""}
              placeholder="adresse@exemple.fr"
              className="min-w-48 flex-1 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent"
            />
            <SubmitButton variant="secondary">Créer l&apos;invitation</SubmitButton>
          </div>
        </form>
      )}

      {!access && invitation && (
        <div className="px-4 py-3">
          <p className="mb-2.5 text-sm text-ink-soft">
            Envoyez ce lien à <strong className="text-ink">{invitation.email}</strong>.
            Il est valable jusqu&apos;au {formatDate(invitation.expires_at)}.
          </p>

          <InvitationLink token={invitation.token} />

          <p className="mt-2.5 text-xs text-ink-faint">
            Oasis Care Pro n&apos;envoie pas encore d&apos;e-mail : copiez ce lien
            dans votre message habituel. Ne le publiez nulle part — il ouvre
            l&apos;accès aux documents de ce client.
          </p>

          <form action={cancelInvitation} className="mt-3">
            <input type="hidden" name="invitation_id" value={invitation.id} />
            <input type="hidden" name="customer_id" value={customerId} />
            <SubmitButton variant="secondary">Annuler l&apos;invitation</SubmitButton>
          </form>
        </div>
      )}

      {access && (
        <div className="px-4 py-3">
          <p className="text-sm text-ink-soft">
            Ce client consulte son espace depuis le {formatDate(access.created_at)}.
          </p>

          <div className="mt-3 border-t border-line pt-3">
            <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">
              Livrer un jardin
            </p>
            <p className="mt-1 text-xs text-ink-soft">
              Le plan passe dans SON application Oasis Care, et lui en devient
              propriétaire. Vous gardez un accès pour continuer à l&apos;entretenir
              — qu&apos;il peut vous retirer. Vos devis, vos coûts et vos marges ne
              bougent pas.
            </p>

            {gardens.length === 0 ? (
              <p className="mt-2 text-sm text-ink-faint">
                Aucun jardin rattaché à ses propriétés. Créez-en un depuis la
                section « Propriétés » ci-dessus.
              </p>
            ) : (
              <ul className="mt-2 flex flex-col gap-2">
                {gardens.map((garden) => (
                  <li key={garden.id} className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{garden.name}</span>
                      <span className="block truncate text-xs text-ink-faint">
                        {garden.siteName}
                      </span>
                    </span>
                    {garden.deliveredAt ? (
                      <Badge tone="positive">
                        Livré le {formatDate(garden.deliveredAt)}
                      </Badge>
                    ) : (
                      <form action={deliverGarden}>
                        <input type="hidden" name="garden_id" value={garden.id} />
                        <input type="hidden" name="customer_id" value={customerId} />
                        <SubmitButton variant="secondary">Livrer le jardin</SubmitButton>
                      </form>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <form action={revokePortalAccess} className="mt-3 border-t border-line pt-3">
            <input type="hidden" name="access_id" value={access.id} />
            <input type="hidden" name="customer_id" value={customerId} />
            <SubmitButton variant="secondary">Fermer l&apos;accès au portail</SubmitButton>
            <p className="mt-1.5 text-xs text-ink-faint">
              Fermer le portail ne reprend pas les jardins déjà livrés : ils lui
              appartiennent.
            </p>
          </form>
        </div>
      )}
    </Card>
  );
}
