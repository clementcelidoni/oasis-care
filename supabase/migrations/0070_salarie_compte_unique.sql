-- Oasis Care — un compte Oasis ne désigne qu'une fiche salarié.
--
-- `employees.user_id` existe depuis 0051 mais n'avait jamais été
-- écrit : aucune interface ne rattachait un compte à une fiche. Elle
-- existe maintenant (« Fiche salarié » sur chaque compte de la page
-- Équipe), et l'action détache l'ancienne fiche avant d'en rattacher
-- une nouvelle.
--
-- Cet index dit la même chose, mais du côté où ça ne peut pas être
-- oublié. Si deux fiches portaient le même compte, les heures pointées
-- par cette personne se rattacheraient à deux salariés au coût horaire
-- différent, et le coût de main-d'œuvre d'un chantier deviendrait
-- indéterminé — pas faux d'une façon visible, indéterminé. Une
-- application prudente évite ça ; une contrainte l'empêche.
--
-- La clé porte l'organisation : un même compte peut très bien être
-- salarié chez deux entreprises différentes du produit (un
-- sous-traitant, un gérant de deux sociétés). Ce qui est interdit,
-- c'est deux fiches pour lui DANS la même entreprise.
--
-- `where user_id is not null` : la grande majorité des fiches n'ont pas
-- de compte — un intérimaire de trois jours est pointé sans jamais
-- ouvrir le logiciel — et NULL ne doit pas entrer en collision avec
-- NULL.

create unique index if not exists employees_organization_user_unique
  on public.employees (organization_id, user_id)
  where user_id is not null;
