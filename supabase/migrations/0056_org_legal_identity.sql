-- Oasis Care — Phase 11 : l'identité légale de l'entreprise.
--
-- À exécuter après 0055. Idempotente et purement additive.
--
-- POURQUOI CE FICHIER EXISTE.
--
-- Les pages d'impression du devis (Milestone 5) et de la facture
-- (Milestone 10) demandent déjà `siret`, `vat_number`, `address_line1`,
-- `postal_code`, `city`, `email` et `phone` à `business_organizations`.
-- Aucune de ces colonnes n'existe. PostgREST répond par une erreur que
-- ces pages ne lisent pas, l'entête retombe sur « Oasis Care Pro », et
-- le document sort SANS identité d'émetteur.
--
-- Ça ne se voyait nulle part : pas d'exception, pas de page blanche,
-- juste un devis qui a l'air normal. En France, un devis ou une facture
-- sans SIRET, sans adresse et sans numéro de TVA n'est pas un document
-- valable — et pour un paysagiste, l'assurance décennale est une
-- mention obligatoire de plus.
--
-- On ajoute donc les colonnes que le code réclamait déjà, et celles que
-- la loi réclame avec elles.

alter table public.business_organizations
  add column if not exists legal_form text,
  add column if not exists siret text,
  add column if not exists vat_number text,
  add column if not exists rcs_city text,
  add column if not exists share_capital_cents bigint,

  add column if not exists address_line1 text,
  add column if not exists address_line2 text,
  add column if not exists postal_code text,
  add column if not exists city text,

  add column if not exists email text,
  add column if not exists phone text,
  add column if not exists website text,

  -- §mentions obligatoires — « Assurance décennale : assureur, numéro de
  -- contrat, couverture géographique. » Un champ libre plutôt que trois
  -- colonnes : la formulation exacte varie d'un assureur à l'autre, et
  -- c'est le texte que le professionnel recopie de son attestation.
  add column if not exists insurance_details text;

-- `contact_details` reste en place, vide et inutilisée. On ne s'en sert
-- pas : une adresse rangée dans un jsonb ne se cherche pas, ne se
-- contrôle pas, et se faute en silence à la première clé mal écrite.

comment on column public.business_organizations.siret is
  'SIRET à 14 chiffres. Mention obligatoire sur les devis et factures.';
comment on column public.business_organizations.insurance_details is
  'Assurance décennale — mention obligatoire pour les travaux de paysage.';

-- ============================================================
-- Le client voit l'entête, comme sur le papier
-- ============================================================
-- La vue du Milestone 11 ne rendait que le nom. Ces colonnes-là sont
-- celles qui figurent déjà sur chaque devis qu'il a reçu par courrier :
-- les lui cacher dans son portail n'aurait protégé personne, et son
-- exemplaire n'aurait pas ressemblé au document d'origine.
--
-- Rien d'interne ne passe : ni `workspace_id`, ni `tax_configuration`,
-- ni les réglages.
create or replace view public.client_portal_companies
with (security_invoker = false) as
select distinct
  o.id, o.name, o.business_type,
  o.legal_name, o.legal_form, o.siret, o.vat_number, o.rcs_city,
  o.address_line1, o.address_line2, o.postal_code, o.city,
  o.email, o.phone, o.website, o.insurance_details
from public.business_organizations o
join public.client_portal_access a on a.organization_id = o.id
where a.user_id = auth.uid() and a.revoked_at is null;

grant select on public.client_portal_companies to authenticated;
