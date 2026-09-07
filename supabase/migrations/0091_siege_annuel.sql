-- Oasis Care — LE PRIX ANNUEL DU SIÈGE SUPPLÉMENTAIRE (migration 0091).
--
-- ============================================================
-- UNE DÉCISION ATTENDUE, ENFIN PRISE
-- ============================================================
--
-- 0083 posait la question et refusait d'y répondre, en toutes lettres :
--
--     « LE SIÈGE SUPPLÉMENTAIRE N'A PAS DE PRIX ANNUEL DANS 0081, et
--       c'est une décision qui n'a pas été prise plutôt qu'un oubli
--       technique. Dix fois 9,90 ou douze fois ? Tant que le dirigeant
--       n'a pas tranché, on bloque au lieu de choisir à sa place. »
--
-- Le blocage était juste. Sans lui, un abonné annuel de sept
-- utilisateurs sur une offre qui en comprend cinq aurait été facturé
-- 799 € et ses deux sièges en trop seraient passés à la trappe — en
-- silence, sans erreur, et pour la durée de l'abonnement.
--
-- LE DIRIGEANT A TRANCHÉ : 99,00 € par siège et par an.
--
-- ============================================================
-- POURQUOI 99 ET NON 118,80
-- ============================================================
--
-- Le choix n'est pas « environ dix-sept pour cent de remise ». La
-- grille suit une règle EXACTE, vérifiée sur chacune de ses lignes :
--
--     L'ANNÉE VAUT DIX MOIS.
--       Pro Solo      39,90 × 10 =   399,00   ✓
--       Pro           79,90 × 10 =   799,00   ✓
--       Pro Business 139,90 × 10 = 1 399,00   ✓
--       BioLab        20,00 × 10 =   200,00   ✓
--       Pépinière     20,00 × 10 =   200,00   ✓
--
-- Sans exception. Le siège n'avait aucune raison d'y échapper :
-- 9,90 × 10 = 99,00. Faire payer le siège douze mois pendant que tout
-- le reste en paie dix serait remarqué, et à juste titre.
--
-- Cette règle mérite d'être écrite ici parce qu'elle ne se déduit
-- d'aucune colonne : elle vit dans les nombres, et le jour où
-- quelqu'un ajoutera une offre, il doit savoir laquelle appliquer.

-- ------------------------------------------------------------
-- 1. LA COLONNE
-- ------------------------------------------------------------
-- Additive, nullable, et le NULL garde son sens : « pas décidé pour
-- cette offre ». Enterprise reste à NULL, comme ses autres prix — elle
-- est sur devis, et un siège n'y a pas de tarif public non plus.

alter table public.organization_plans
  add column if not exists extra_seat_yearly_price_cents bigint;

alter table public.organization_plans
  drop constraint if exists organization_plans_extra_seat_yearly_positive;
alter table public.organization_plans
  add constraint organization_plans_extra_seat_yearly_positive
  check (extra_seat_yearly_price_cents is null or extra_seat_yearly_price_cents > 0);

comment on column public.organization_plans.extra_seat_yearly_price_cents is
  'Prix annuel HT, en centimes, d''un siège au-delà de included_seats. NULL veut dire « non décidé pour cette offre », jamais « gratuit ». Règle de la grille : l''année vaut DIX mois — 9,90 × 10 = 99,00.';

-- ------------------------------------------------------------
-- 2. LE PRIX, SUR LES TROIS OFFRES QUI SE SOUSCRIVENT
-- ------------------------------------------------------------
-- Enterprise est délibérément laissée de côté : is_quote_only, aucun
-- prix public, et un siège n'en a pas davantage.

update public.organization_plans
   set extra_seat_yearly_price_cents = 9900,
       updated_at = now()
 where key in ('solo', 'team', 'business')
   and extra_seat_yearly_price_cents is distinct from 9900;

-- ------------------------------------------------------------
-- 3. LA RÉSOLUTION DE TARIF CESSE DE BLOQUER
-- ------------------------------------------------------------
-- On ne remplace pas la fonction entière : on remplace le seul bloc qui
-- refusait. Le reste de billing_provider_price_terms — les offres, les
-- modules, la matrice, les remises — est correct et éprouvé ; le
-- réécrire au complet pour trois lignes serait risquer d'y perdre autre
-- chose.
--
-- LE MOTIF DE BLOCAGE NE DISPARAÎT PAS POUR AUTANT. Il change de sens :
-- il ne dit plus « personne n'a décidé » mais « cette offre-ci n'a pas
-- de prix annuel de siège » — ce qui reste vrai d'Enterprise. Un motif
-- qu'on supprime est un cas qu'on cesse de voir.

-- L'ANCRE EST COURTE ET SANS SAUT DE LIGNE, VOLONTAIREMENT. Le corps
-- stocké par PostgreSQL porte les fins de ligne du fichier d'origine —
-- ici des CRLF Windows — et une ancre multiligne écrite avec des LF ne
-- correspond à rien. Une première version de cette migration s'est fait
-- refuser par son propre garde-fou pour cette raison exacte : il a bien
-- travaillé, et l'ancre a été raccourcie plutôt que le garde affaibli.
do $$
declare
  v_def text;
  v_ancre constant text := 'v_block := ''seatYearlyPriceUndecided'';';
  v_neuf constant text :=
    '/* 0091 : décidé à 99,00 EUR, soit 9,90 x DIX comme toute la grille. '
    'Enterprise reste NULL et bloque encore, ce qui est juste : sur devis. */ '
    'v_our := v_plan.extra_seat_yearly_price_cents; '
    'if v_our is null then v_block := ''seatYearlyPriceUndecided''; end if;';
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'billing_provider_price_terms'
   limit 1;

  if v_def is null then
    raise exception 'billing_provider_price_terms est introuvable : 0083 n''a pas été appliquée.';
  end if;

  -- Le motif doit apparaître UNE SEULE FOIS. S'il y en avait deux, un
  -- remplacement global toucherait un endroit qu'on n'a pas lu.
  if (length(v_def) - length(replace(v_def, v_ancre, ''))) / length(v_ancre) <> 1 then
    raise exception
      'L''ancre du siège annuel apparaît % fois au lieu d''une dans billing_provider_price_terms. Relire avant de remplacer.',
      (length(v_def) - length(replace(v_def, v_ancre, ''))) / length(v_ancre);
  end if;

  execute replace(v_def, v_ancre, v_neuf);
  raise notice 'billing_provider_price_terms : le siège annuel se résout désormais.';
end;
$$;
