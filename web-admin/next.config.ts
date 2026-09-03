import type { NextConfig } from "next";

/**
 * Oasis Care Control Center — configuration Next.
 *
 * DEUX RÈGLES DE SÉCURITÉ SONT ÉCRITES ICI, et non dans un commentaire.
 *
 * 1. `serverExternalPackages` n'est pas utilisé, et aucune variable
 *    d'environnement n'est exposée via `env` : Next n'inline dans le
 *    bundle du navigateur que ce qui est préfixé `NEXT_PUBLIC_`.
 *    `SUPABASE_SERVICE_ROLE_KEY` ne l'est pas, donc elle vaut
 *    littéralement `undefined` côté client — la fuite n'est pas
 *    seulement interdite, elle est impossible par ce chemin. Ajouter un
 *    bloc `env: { ... }` ici la rétablirait ; ne le faites pas.
 *
 * 2. Les en-têtes ci-dessous s'appliquent à TOUTES les réponses. Une
 *    console d'administration n'a aucune raison d'être indexée, ni
 *    d'être chargée dans l'iframe d'un autre site, ni de transmettre
 *    l'URL de la page qu'on quitte à une destination extérieure — cette
 *    URL contient des identifiants d'utilisateurs et d'entreprises.
 */
const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Pas d'indexation, pas de mise en cache par un intermédiaire.
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
          // Le clickjacking sur une console d'administration se paie
          // en actions administratives involontaires.
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          // `same-origin` et pas `strict-origin-when-cross-origin` :
          // une URL d'ici ne doit jamais partir ailleurs, même
          // tronquée à son origine.
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
    ];
  },
};

export default nextConfig;
