import { redirect } from "next/navigation";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import type { PortalCompany } from "@/lib/portal/types";

/**
 * §11S — le TROISIÈME axe d'accès.
 *
 * Oasis Care en avait déjà deux : l'espace de travail (l'app iPhone) et
 * l'organisation (Oasis Care Pro). Le portail en ajoute un : un compte
 * qui n'est membre de rien, rattaché à une ou plusieurs FICHES CLIENTS.
 *
 * Ces trois axes ne doivent jamais se croiser. D'où un module séparé
 * plutôt qu'une branche dans `organization.ts` : un client n'a pas de
 * rôle, pas de permissions, pas d'espace de travail professionnel, et
 * un helper qui lui en fabriquerait un par défaut finirait par lui
 * ouvrir un écran interne.
 */

/**
 * Les entreprises qui ont invité ce compte.
 *
 * La vue est en `security definer` et filtre sur `auth.uid()` : elle ne
 * rend jamais que les entreprises du compte connecté, même si on
 * l'interroge sans clause.
 */
export async function getPortalCompanies(): Promise<PortalCompany[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("client_portal_companies")
    .select("*")
    .order("name");

  if (error || !data) return [];
  return data as PortalCompany[];
}

/**
 * Ce compte est-il client de quelqu'un ?
 *
 * Sert à aiguiller après la connexion. Un compte peut être les deux —
 * un paysagiste peut faire appel à un confrère — donc la question n'est
 * jamais « client OU professionnel », mais « a-t-il aussi un portail ».
 */
export async function hasPortalAccess(): Promise<boolean> {
  const companies = await getPortalCompanies();
  return companies.length > 0;
}

/**
 * L'entrée du portail, ou une redirection.
 *
 * Un compte sans accès ne voit pas une page vide : les vues `client_*`
 * lui rendraient zéro ligne partout, ce qui ressemble à une panne. On
 * l'envoie là où il a quelque chose à faire.
 */
export async function requirePortal(): Promise<PortalCompany[]> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const companies = await getPortalCompanies();
  if (companies.length === 0) redirect("/bienvenue");
  return companies;
}
