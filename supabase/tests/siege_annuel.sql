-- Oasis Care — L'ÉPREUVE DU PRIX ANNUEL DU SIÈGE (migration 0091).
--
-- UN SEUL bloc begin/rollback : un fichier découpé verrait son premier
-- rollback annuler la migration posée devant.

begin;

create temp table res(nom text, attendu text, obtenu text) on commit drop;

-- ============================================================
-- 1. LA RÈGLE DE LA GRILLE : L'ANNÉE VAUT DIX MOIS
-- ============================================================
-- Ce n'est pas une coquetterie de test. Si quelqu'un ajoute un jour une
-- offre en calculant « moins 17 % » au lieu de « fois dix », l'écart
-- passera inaperçu jusqu'à la première facture annuelle.

insert into res
select 'la règle x10 tient sur ' || key, (monthly_price_cents * 10)::text, yearly_price_cents::text
  from public.organization_plans
 where key in ('solo', 'team', 'business');

insert into res
select 'et le siège annuel la suit aussi', (extra_seat_monthly_price_cents * 10)::text,
       extra_seat_yearly_price_cents::text
  from public.organization_plans where key = 'team';

-- ============================================================
-- 2. LE PRIX EST POSÉ, ET SEULEMENT OÙ IL DOIT L'ÊTRE
-- ============================================================

insert into res
select 'siège annuel sur ' || key, '9900', coalesce(extra_seat_yearly_price_cents::text, 'NULL')
  from public.organization_plans where key in ('solo', 'team', 'business');

-- Enterprise est sur devis : elle n'a pas de prix public, et son siège
-- non plus. Un NULL ici est la bonne réponse, pas un oubli.
insert into res
select 'Enterprise reste sans prix de siège', 'NULL',
       coalesce(extra_seat_yearly_price_cents::text, 'NULL')
  from public.organization_plans where key = 'enterprise';

-- ============================================================
-- 3. LA RÉSOLUTION DE TARIF NE BLOQUE PLUS
-- ============================================================
-- C'était le symptôme : la correspondance Stripe existait, la base
-- refusait quand même parce qu'elle n'avait pas de prix à confronter.

insert into res
select 'Pro annuel : le siège se résout', '9900',
       coalesce(t.our_amount_cents::text, 'BLOQUÉ:' || coalesce(t.blocking_reason, '?'))
  from public.billing_provider_price_terms('stripe', 'test', 'seat', 'team', 'yearly') t;

insert into res
select 'Business annuel : le siège se résout', '9900',
       coalesce(t.our_amount_cents::text, 'BLOQUÉ:' || coalesce(t.blocking_reason, '?'))
  from public.billing_provider_price_terms('stripe', 'test', 'seat', 'business', 'yearly') t;

-- Le mensuel ne doit pas avoir bougé — on ajoute, on ne remplace pas.
insert into res
select 'le mensuel est intact', '990',
       coalesce(t.our_amount_cents::text, 'BLOQUÉ:' || coalesce(t.blocking_reason, '?'))
  from public.billing_provider_price_terms('stripe', 'test', 'seat', 'team', 'monthly') t;

-- Enterprise bloque ENCORE, et pour une raison MEILLEURE que celle que
-- ce test attendait d'abord : « planIsQuoteOnly », pas
-- « seatYearlyPriceUndecided ». La fonction vérifie que l'offre est sur
-- devis AVANT de regarder le prix du siège — l'ordre est le bon, parce
-- qu'une offre sans prix public n'a pas de siège tarifé par définition,
-- et le motif rendu dit la vraie cause plutôt que son symptôme.
insert into res
select 'Enterprise annuel bloque, et dit pourquoi', 'planIsQuoteOnly',
       coalesce(t.blocking_reason, 'AUCUN BLOCAGE — anormal')
  from public.billing_provider_price_terms('stripe', 'test', 'seat', 'enterprise', 'yearly') t;

-- ============================================================
-- 4. RIEN D'AUTRE N'A ÉTÉ CASSÉ
-- ============================================================
-- Remplacer une fonction de cette taille pour trois lignes, c'est
-- risquer d'y perdre autre chose. On revérifie ses autres réponses.

insert into res
select 'les offres se résolvent encore', '7990',
       coalesce(t.our_amount_cents::text, 'BLOQUÉ:' || coalesce(t.blocking_reason, '?'))
  from public.billing_provider_price_terms('stripe', 'test', 'plan', 'team', 'monthly') t;

insert into res
select 'un module inclus ne se facture toujours pas', 'moduleIncludedInPlan',
       coalesce(t.blocking_reason, 'AUCUN BLOCAGE — le client paierait deux fois')
  from public.billing_provider_price_terms('stripe', 'test', 'module', 'business', 'monthly', 'biolab') t;

insert into res
select 'le Fondateur reste réservé à Pro', 'discountReservedToAnotherPlan',
       coalesce(t.blocking_reason, 'AUCUN BLOCAGE — 90 EUR/mois de fuite')
  from public.billing_provider_price_terms('stripe', 'test', 'discount', 'business', 'monthly', null, 'FONDATEUR') t;

insert into res
select 'le Fondateur se résout sur Pro', '4990',
       coalesce(t.our_amount_cents::text, 'BLOQUÉ:' || coalesce(t.blocking_reason, '?'))
  from public.billing_provider_price_terms('stripe', 'test', 'discount', 'team', 'monthly', null, 'FONDATEUR') t;

-- ============================================================
-- 5. LA CONTRAINTE
-- ============================================================

do $$
declare v_refuse boolean := false;
begin
  begin
    update public.organization_plans set extra_seat_yearly_price_cents = 0 where key = 'team';
  exception when check_violation then v_refuse := true;
  end;
  insert into res values ('un siège annuel à zéro est refusé', 'true', v_refuse::text);
end;
$$;

-- ============================================================
-- LE VERDICT
-- ============================================================

select case when obtenu is not distinct from attendu then '  OK  ' else ' ÉCHEC' end as etat,
       nom, '[attendu ' || attendu || ', obtenu ' || coalesce(obtenu, 'NULL') || ']' as detail
  from res order by nom;

select count(*) filter (where obtenu is not distinct from attendu) || '/' || count(*)
       || ' tests passés' as resultat
  from res;

rollback;
