/**
 * §TVA — LE SERVICE EUROPÉEN VIES, ET LES TROIS RÉPONSES QU'IL DONNE.
 *
 * ══════════════════════════════════════════════════════════════════
 * TROIS ÉTATS, JAMAIS DEUX
 * ══════════════════════════════════════════════════════════════════
 *
 * VIES est un guichet unique posé DEVANT vingt-sept registres
 * nationaux. Il ne détient aucune donnée : il relaie la question à
 * l'État membre concerné et rend sa réponse. Donc il tombe — pas en
 * bloc, mais État par État, et régulièrement.
 *
 *   VALIDE        le registre a répondu « ce numéro est attribué ».
 *   REFUSÉ        le registre a répondu « ce numéro n'existe pas ».
 *   INDISPONIBLE  le registre n'a pas répondu, ou a répondu quelque
 *                 chose qu'on ne sait pas lire.
 *
 * LE TROISIÈME EST TOUT L'ENJEU DE CE FICHIER. Le confondre avec un
 * refus fait perdre, pendant une panne du registre belge, tous les
 * clients belges — et personne ne comprend pourquoi. Le confondre avec
 * une validation fait facturer 0 % à quelqu'un qui n'est peut-être pas
 * assujetti, et Oasis Care reste redevable de la TVA. Les deux erreurs
 * coûtent, et elles coûtent dans des sens opposés.
 *
 * D'OÙ LA RÈGLE DE CE FICHIER, qui n'a aucune exception :
 * TOUT CE QUI N'EST PAS UNE RÉPONSE CLAIRE EST « INDISPONIBLE ».
 * Un corps vide, du HTML de page d'erreur, du XML tronqué, un code de
 * panne qu'on ne connaît pas, un délai dépassé : indisponible. On
 * réessaiera. On ne refuse jamais faute d'avoir compris.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE FICHIER NE LANCE JAMAIS D'EXCEPTION VERS SON APPELANT
 * ══════════════════════════════════════════════════════════════════
 *
 * Un analyseur qui plante sur une réponse étrange ne bloque pas
 * seulement un client : il fait échouer la tâche qui vide la file, donc
 * il bloque tous les autres derrière lui. `analyserReponseVies()` rend
 * toujours un résultat, `consulterVies()` aussi — y compris quand le
 * transport lui-même explose.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE QU'ON NE GARDE PAS
 * ══════════════════════════════════════════════════════════════════
 *
 * VIES renvoie, pour un numéro valide, le NOM et l'ADRESSE de
 * l'entreprise tels que son registre national les détient. On ne les
 * lit pas et on ne les conserve pas : ce n'est pas nous qui les avons
 * demandés, l'entreprise a déjà saisi les siens, et deux adresses
 * enregistrées finissent toujours par diverger. Ce fichier ne retient
 * que l'état, la preuve, et de quoi réessayer.
 *
 * ══════════════════════════════════════════════════════════════════
 * AUCUN APPEL RÉSEAU N'A LIEU DANS LES TESTS
 * ══════════════════════════════════════════════════════════════════
 *
 * Le transport est un paramètre. Les tests en injectent un qui rend ce
 * qu'ils veulent — y compris du charabia et un délai qui ne finit
 * jamais. Un test qui exigerait VIES ne tournerait pas : le service
 * tombe, et c'est le sujet même de ce fichier.
 */

// ==================================================================
// CE QUE VIES A RÉPONDU
// ==================================================================

/**
 * Les trois états, écrits EXACTEMENT comme `saas_vies_record_result()`
 * les attend (migration 0089 § 7.e). Les mots sont français côté base
 * comme ici : un mappage entre deux vocabulaires serait un endroit de
 * plus où se tromper.
 */
export type EtatVies = "valide" | "refuse" | "indisponible";

export type ResultatVies = {
  etat: EtatVies;
  /**
   * LE NUMÉRO DE CONSULTATION, quand VIES en rend un. C'est la preuve
   * opposable en contrôle : sans lui, « validé » n'est qu'une
   * affirmation de notre part.
   *
   * Il n'arrive QUE si l'on s'identifie soi-même dans la requête (le
   * couple `demandeur`). Une consultation anonyme rend « valide » sans
   * preuve — c'est licite, mais ça ne se produit pas devant un
   * inspecteur.
   */
  numeroConsultation: string | null;
  /**
   * Ce que VIES a répondu, en clair, destiné à l'écran d'administration
   * et à `vies_last_error`. Jamais une trace technique brute : une
   * phrase qu'un humain peut lire pour décider s'il appelle le client
   * ou s'il attend.
   */
  message: string | null;
};

/** Un numéro intracommunautaire découpé comme VIES le demande. */
export type NumeroDecoupe = {
  /** Le code à deux lettres du registre interrogé. « EL » pour la Grèce. */
  pays: string;
  /** Le reste du numéro, sans le préfixe. */
  corps: string;
};

// ==================================================================
// DÉCOUPER LE NUMÉRO
// ==================================================================

/**
 * Sépare le préfixe pays du corps du numéro.
 *
 * LE CAS GREC EST DÉJÀ RÉGLÉ EN AMONT : `identite.ts` impose qu'une
 * entreprise dont le pays est « GR » porte un numéro commençant par
 * « EL », parce que c'est le préfixe fiscal grec. On découpe donc
 * bêtement les deux premiers caractères, et c'est juste — inventer ici
 * une seconde table de correspondance créerait une seconde vérité.
 *
 * Rend `null` si le numéro n'a pas la forme minimale attendue. Le
 * refuser AVANT d'interroger évite deux choses : une requête certaine
 * d'échouer, et surtout l'entrée d'un caractère quelconque dans le XML
 * fabriqué juste en dessous.
 */
export function decouperNumeroTva(brut: string | null | undefined): NumeroDecoupe | null {
  const numero = (brut ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!/^[A-Z]{2}[0-9A-Z]{2,12}$/.test(numero)) return null;
  return { pays: numero.slice(0, 2), corps: numero.slice(2) };
}

// ==================================================================
// LA REQUÊTE
// ==================================================================

/** Le guichet SOAP historique de la Commission européenne. */
export const URL_VIES_SOAP =
  "https://ec.europa.eu/taxation_customs/vies/services/checkVatService";

/**
 * L'enveloppe SOAP, fabriquée à la main.
 *
 * POURQUOI PAS DE BIBLIOTHÈQUE SOAP : celle-ci fait douze lignes, elle
 * n'ajoute aucune dépendance, et surtout elle n'a AUCUNE surface
 * d'attaque — les seules valeurs interpolées viennent de
 * `decouperNumeroTva()`, qui n'accepte que des lettres majuscules et
 * des chiffres. Rien de ce qui entre ici ne peut refermer une balise.
 *
 * `demandeur` déclenche `checkVatApprox`, la forme de la requête où
 * l'on donne son propre numéro et où VIES rend, en échange, un NUMÉRO
 * DE CONSULTATION. C'est le seul moyen d'obtenir la preuve opposable ;
 * sans lui la réponse est exacte mais indémontrable.
 */
export function enveloppeCheckVat(
  cible: NumeroDecoupe,
  demandeur?: NumeroDecoupe | null,
): string {
  const avecPreuve = demandeur !== null && demandeur !== undefined;
  const operation = avecPreuve ? "checkVatApprox" : "checkVat";
  const identification = avecPreuve
    ? `<urn:requesterCountryCode>${demandeur.pays}</urn:requesterCountryCode>` +
      `<urn:requesterVatNumber>${demandeur.corps}</urn:requesterVatNumber>`
    : "";

  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"' +
    ' xmlns:urn="urn:ec.europa.eu:taxud:vies:services:checkVat:types">' +
    "<soapenv:Header/><soapenv:Body>" +
    `<urn:${operation}>` +
    `<urn:countryCode>${cible.pays}</urn:countryCode>` +
    `<urn:vatNumber>${cible.corps}</urn:vatNumber>` +
    identification +
    `</urn:${operation}>` +
    "</soapenv:Body></soapenv:Envelope>"
  );
}

// ==================================================================
// LES CODES DE PANNE, ET DE QUEL CÔTÉ ILS TOMBENT
// ==================================================================

/**
 * CES CODES SIGNIFIENT « ON NE SAIT PAS », JAMAIS « NON ».
 *
 * Ils décrivent l'état du guichet ou du registre national, pas celui du
 * numéro. Les traiter comme un refus reviendrait à radier un client
 * parce que son administration fiscale redémarre un serveur.
 */
const PANNES: ReadonlySet<string> = new Set([
  "SERVICE_UNAVAILABLE",
  "MS_UNAVAILABLE",
  "MS_UNAVAILABLE_DUE_TO_MAINTENANCE",
  "TIMEOUT",
  "SERVER_BUSY",
  "MS_MAX_CONCURRENT_REQ",
  "GLOBAL_MAX_CONCURRENT_REQ",
  // Notre propre identification est refusée : c'est un défaut de
  // configuration de NOTRE côté. Il n'apprend rien sur le numéro du
  // client, donc il ne peut pas valoir refus. Il se réessaie, et il se
  // voit dans `vies_last_error` jusqu'à ce qu'un humain le corrige.
  "INVALID_REQUESTER_INFO",
]);

/**
 * LE SEUL CODE QUI VAUT REFUS.
 *
 * `INVALID_INPUT` veut dire que le couple pays + numéro n'est pas
 * recevable : ce n'est pas une panne, c'est une saisie à corriger. La
 * phrase montrée au client le dit dans ces termes-là.
 */
const REFUS: ReadonlySet<string> = new Set(["INVALID_INPUT"]);

// ==================================================================
// LIRE LA RÉPONSE — SANS JAMAIS PLANTER
// ==================================================================

/** Une portion lisible d'une réponse inattendue, pour l'écran d'administration. */
function extraitLisible(corps: string): string {
  const propre = corps.replace(/\s+/g, " ").trim();
  return propre.length > 200 ? `${propre.slice(0, 200)}…` : propre;
}

function baliseTexte(corps: string, nom: string): string | null {
  // Les préfixes de namespace changent d'une version du service à
  // l'autre (`ns2:valid`, `tns1:valid`, `valid`). Les ignorer plutôt que
  // de les énumérer évite de casser au prochain déploiement de la
  // Commission.
  const motif = new RegExp(
    `<(?:[A-Za-z0-9_.-]+:)?${nom}\\b[^>]*>([\\s\\S]*?)</(?:[A-Za-z0-9_.-]+:)?${nom}>`,
    "i",
  );
  const trouve = motif.exec(corps);
  return trouve === null ? null : trouve[1].trim();
}

function panne(message: string): ResultatVies {
  return { etat: "indisponible", numeroConsultation: null, message };
}

function refus(message: string): ResultatVies {
  return { etat: "refuse", numeroConsultation: null, message };
}

/**
 * Le code de panne rendu par VIES, quelle que soit la forme du message.
 *
 * En SOAP il vit dans `<faultstring>` ; en REST il vit dans `userError`
 * ou dans `errorWrappers[].error`. Les trois portent les mêmes mots.
 */
function codeDePanne(texte: string | null): string | null {
  if (texte === null) return null;
  const trouve = /[A-Z][A-Z_]{3,}/.exec(texte.toUpperCase());
  return trouve === null ? null : trouve[0];
}

function verdictDepuisCode(code: string | null, texteBrut: string): ResultatVies {
  if (code !== null && REFUS.has(code)) {
    return refus("Le registre européen ne reconnaît pas ce numéro (INVALID_INPUT).");
  }
  if (code !== null && PANNES.has(code)) {
    return panne(`Registre indisponible (${code}).`);
  }
  // UN CODE INCONNU EST UNE PANNE. La Commission en ajoute au fil des
  // versions ; deviner qu'un code jamais vu signifie « non » serait
  // exactement l'erreur qui coûte des clients.
  return panne(
    code === null
      ? `Réponse illisible du registre européen : ${extraitLisible(texteBrut)}`
      : `Réponse inconnue du registre européen (${code}).`,
  );
}

/**
 * VIES a-t-il répondu à propos DU numéro qu'on lui a posé ?
 *
 * Le service renvoie en écho le pays et le numéro interrogés. S'ils ne
 * correspondent pas — requête croisée, cache mal appairé, réponse
 * recopiée — enregistrer « validé » attacherait la preuve d'un numéro à
 * un autre. C'est précisément le trou que `vat_number_checked` referme
 * en base ; on le referme aussi ici, en amont.
 */
function echoConforme(corps: string, attendu: NumeroDecoupe | null): boolean {
  if (attendu === null) return true;
  const pays = baliseTexte(corps, "countryCode");
  const numero = baliseTexte(corps, "vatNumber");
  if (pays === null && numero === null) return true; // Le service n'a rien renvoyé en écho.
  if (pays !== null && pays.toUpperCase() !== attendu.pays) return false;
  if (numero !== null && numero.toUpperCase().replace(/[^A-Z0-9]/g, "") !== attendu.corps) {
    return false;
  }
  return true;
}

type CorpsRest = {
  valid?: unknown;
  isValid?: unknown;
  userError?: unknown;
  requestIdentifier?: unknown;
  errorWrappers?: unknown;
  countryCode?: unknown;
  vatNumber?: unknown;
};

function texteOuNull(valeur: unknown): string | null {
  return typeof valeur === "string" && valeur.trim() !== "" ? valeur.trim() : null;
}

function echoConformeRest(objet: CorpsRest, attendu: NumeroDecoupe): boolean {
  const pays = texteOuNull(objet.countryCode);
  const numero = texteOuNull(objet.vatNumber);
  if (pays === null && numero === null) return true;
  if (pays !== null && pays.toUpperCase() !== attendu.pays) return false;
  if (numero !== null && numero.toUpperCase().replace(/[^A-Z0-9]/g, "") !== attendu.corps) {
    return false;
  }
  return true;
}

/**
 * LA RÉPONSE, QUELLE QU'ELLE SOIT.
 *
 * `statutHttp` vaut 0 quand la requête n'a pas abouti du tout.
 * `attendu` sert au contrôle d'écho décrit plus haut ; le passer reste
 * facultatif, pour que la fonction serve aussi à relire une réponse
 * recopiée à la main dans un incident.
 *
 * CETTE FONCTION NE LANCE JAMAIS. C'est sa raison d'être.
 */
export function analyserReponseVies(
  corpsBrut: string | null | undefined,
  statutHttp: number,
  attendu?: NumeroDecoupe | null,
): ResultatVies {
  try {
    const corps = (corpsBrut ?? "").trim();

    // 5xx, 429, 0 : le guichet n'a pas travaillé. Inutile de lire plus
    // loin, et surtout : ce n'est pas une réponse sur le numéro.
    if (statutHttp === 0 || statutHttp >= 500 || statutHttp === 429) {
      return panne(`Le guichet européen n'a pas répondu (HTTP ${statutHttp}).`);
    }

    if (corps === "") {
      return panne("Le guichet européen a répondu sans contenu.");
    }

    // ---- FORME REST (JSON) ------------------------------------
    if (corps.startsWith("{")) {
      let objet: CorpsRest;
      try {
        objet = JSON.parse(corps) as CorpsRest;
      } catch {
        // Du JSON tronqué en plein milieu, c'est une réponse coupée :
        // une panne de transport, pas un verdict.
        return panne(`Réponse JSON illisible du guichet européen : ${extraitLisible(corps)}`);
      }

      const erreurUtilisateur = texteOuNull(objet.userError);
      // « VALID » et « INVALID » circulent dans ce champ à côté des
      // vrais codes de panne : ce ne sont pas des erreurs.
      const codeUtilisateur = erreurUtilisateur === null ? null : erreurUtilisateur.toUpperCase();
      if (codeUtilisateur === "INVALID") {
        return refus("Le registre européen ne reconnaît pas ce numéro.");
      }
      if (codeUtilisateur !== null && codeUtilisateur !== "VALID" && codeUtilisateur !== "NONE") {
        return verdictDepuisCode(codeDePanne(codeUtilisateur), corps);
      }

      if (Array.isArray(objet.errorWrappers) && objet.errorWrappers.length > 0) {
        const premier = objet.errorWrappers[0] as { error?: unknown; message?: unknown };
        const code = codeDePanne(texteOuNull(premier.error) ?? texteOuNull(premier.message));
        return verdictDepuisCode(code, corps);
      }

      const valide = objet.valid ?? objet.isValid;
      if (valide === true || valide === false) {
        if (attendu !== null && attendu !== undefined && !echoConformeRest(objet, attendu)) {
          return panne(
            "Le guichet européen a répondu à propos d'un autre numéro : réponse écartée par prudence.",
          );
        }
        if (valide === false) {
          return refus("Le registre européen ne reconnaît pas ce numéro.");
        }
        return {
          etat: "valide",
          numeroConsultation: texteOuNull(objet.requestIdentifier),
          message: null,
        };
      }

      return panne(`Réponse JSON inattendue du guichet européen : ${extraitLisible(corps)}`);
    }

    // ---- FORME SOAP (XML) -------------------------------------
    const faute = baliseTexte(corps, "faultstring") ?? baliseTexte(corps, "faultcode");
    if (faute !== null) {
      return verdictDepuisCode(codeDePanne(faute), corps);
    }

    const valide = baliseTexte(corps, "valid");
    if (valide === null) {
      // Ni verdict, ni faute : ce n'est pas du VIES. C'est le plus
      // souvent une page HTML de portail en panne, ou l'interception
      // d'un proxy.
      return panne(`Réponse inattendue du guichet européen : ${extraitLisible(corps)}`);
    }

    if (!echoConforme(corps, attendu ?? null)) {
      return panne(
        "Le guichet européen a répondu à propos d'un autre numéro : réponse écartée par prudence.",
      );
    }

    if (valide.toLowerCase() === "true") {
      return {
        etat: "valide",
        numeroConsultation: baliseTexte(corps, "requestIdentifier"),
        message: null,
      };
    }
    if (valide.toLowerCase() === "false") {
      return refus("Le registre européen ne reconnaît pas ce numéro.");
    }

    return panne(`Verdict illisible du guichet européen : « ${extraitLisible(valide)} ».`);
  } catch (erreur) {
    // LE FILET. Aucune réponse ne doit pouvoir faire tomber la tâche qui
    // vide la file : un client dont la réponse est bizarre ne doit pas
    // empêcher les cinquante suivants d'être traités.
    return panne(
      `Réponse impossible à analyser (${erreur instanceof Error ? erreur.message : String(erreur)}).`,
    );
  }
}

// ==================================================================
// INTERROGER — LE TRANSPORT EST UN PARAMÈTRE
// ==================================================================

export type RequeteHttpVies = {
  url: string;
  entetes: Record<string, string>;
  corps: string;
  /** Annulé au délai dépassé. Un transport qui l'ignore rend le délai inopérant. */
  signal: AbortSignal;
};

export type ReponseHttpVies = {
  statut: number;
  corps: string;
};

export type TransportVies = (requete: RequeteHttpVies) => Promise<ReponseHttpVies>;

export type OptionsConsultation = {
  transport: TransportVies;
  /**
   * Le délai au bout duquel on abandonne. Quinze secondes par défaut :
   * VIES répond en une seconde quand il va bien, et une consultation qui
   * traîne davantage est une panne du registre national — qu'on
   * constatera plus sûrement en réessayant plus tard qu'en attendant.
   */
  delaiMs?: number;
  /** Notre propre numéro, pour obtenir un numéro de consultation opposable. */
  demandeur?: NumeroDecoupe | null;
  url?: string;
};

/**
 * Interroge VIES pour UN numéro et rend l'un des trois états.
 *
 * NE LANCE JAMAIS. Un transport qui explose, un délai dépassé, une
 * réponse illisible : tout finit en « indisponible », c'est-à-dire dans
 * la file de réessai, jamais dans un refus.
 */
export async function consulterVies(
  numero: string,
  options: OptionsConsultation,
): Promise<ResultatVies> {
  const cible = decouperNumeroTva(numero);
  if (cible === null) {
    // On n'a même pas de quoi poser la question. C'est une saisie à
    // corriger, pas une panne : le dire comme tel évite un réessai
    // éternel sur un numéro qui ne sera jamais recevable.
    return refus(
      "Ce numéro n'a pas la forme d'un numéro intracommunautaire : deux lettres de pays, puis 2 à 12 caractères.",
    );
  }

  const delaiMs = options.delaiMs ?? 15_000;
  const controleur = new AbortController();
  const minuteur = setTimeout(() => controleur.abort(), delaiMs);

  try {
    const reponse = await options.transport({
      url: options.url ?? URL_VIES_SOAP,
      entetes: {
        "Content-Type": "text/xml; charset=utf-8",
        SOAPAction: "",
      },
      corps: enveloppeCheckVat(cible, options.demandeur ?? null),
      signal: controleur.signal,
    });
    return analyserReponseVies(reponse.corps, reponse.statut, cible);
  } catch (erreur) {
    if (controleur.signal.aborted) {
      return panne(
        `Le registre de ${cible.pays} n'a pas répondu en ${Math.max(1, Math.round(delaiMs / 1000))} secondes.`,
      );
    }
    return panne(
      `La consultation n'a pas abouti : ${erreur instanceof Error ? erreur.message : String(erreur)}`,
    );
  } finally {
    clearTimeout(minuteur);
  }
}
