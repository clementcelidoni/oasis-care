# L'ordonnanceur de facturation — notice de mise en service

**Pour qui :** le dirigeant. Aucune connaissance technique n'est supposée.
**Combien de temps :** vingt minutes pour tout activer, cinq minutes par semaine pour surveiller.
**Ce que vous ne pouvez pas casser :** tant que vous n'avez pas fait l'étape 3, **rien ne part**. Vous pouvez lire toute cette notice et faire les étapes 1 et 2 sans qu'aucune facture ne soit émise ni aucun courriel envoyé.

---

## De quoi on parle

Jusqu'ici, votre base de données savait facturer, mais **il fallait le lui demander à la main**. Un essai gratuit qui arrivait à son terme y restait pour toujours ; une facture mensuelle ne partait que si quelqu'un cliquait.

L'ordonnanceur est le réveille-matin qui fait ces gestes à votre place, chaque nuit :

| Heure (UTC) | Tâche | Ce qu'elle fait |
|---|---|---|
| 03h15 | `oasis-cycle-facturation` | Constate les essais terminés, produit les factures du mois, avance les périodes. |
| 06h30 | `oasis-relances` | Calcule quelles relances sont dues, et vérifie au passage que la tâche de 03h15 a bien tourné. |

> **Pourquoi ces heures.** 03h15 UTC, c'est après minuit à Paris en toute saison, et hors du créneau des sauvegardes. 06h30 UTC pour les relances, parce qu'un client qui reçoit une relance à trois heures du matin la lit comme une machine — et c'est exactement ce qu'on veut éviter.

**Les deux tâches ne parlent à personne.** Elles calculent et elles écrivent en base, point. Aucun courriel, aucun appel au prestataire de paiement. C'est ce qui les rend sûres : une tâche qui échoue au milieu d'un appel réseau laisse un état indéterminé, alors qu'une écriture en base est tout ou rien.

L'envoi proprement dit — expédier les relances, interroger le registre européen de TVA — est fait par un autre mécanisme, décrit à l'**étape 4**.

---

## Ce qui doit être fait avant

La migration `0089` doit être appliquée. Tant qu'elle ne l'est pas, rien de cette notice n'existe.

Pour le vérifier, dans **Supabase → SQL Editor**, collez ceci et cliquez sur *Run* :

```sql
select to_regprocedure('public.saas_run_billing_cycle(date)') is not null as pret;
```

- `true` → la migration est là, continuez.
- `false` ou une erreur → faites appliquer `0089` d'abord.

---

## Étape 1 — Les deux extensions

Une « extension », chez Supabase, est une brique optionnelle de la base de données. Il en faut potentiellement deux.

### `pg_cron` — le réveille-matin lui-même

C'est lui qui déclenche les tâches à heure fixe. **Sans lui, rien ne tourne**, et la base ne s'en plaint pas : elle attend simplement qu'on lui demande.

1. Ouvrez **Supabase → Database → Extensions**.
2. Tapez `pg_cron` dans la recherche.
3. Basculez l'interrupteur sur **Enabled**.

### `pg_net` — dont vous n'avez probablement pas besoin

`pg_net` permet à la base d'appeler des adresses internet elle-même. **Nos tâches n'en font rien** : elles ne parlent à personne, c'est le principe. Si elle est déjà activée, laissez-la ; sinon, n'y touchez pas.

> **Au 6 septembre 2026, les deux extensions sont déjà activées sur votre projet.** Vous pouvez donc probablement sauter cette étape — vérifiez simplement que l'interrupteur de `pg_cron` est bien sur *Enabled*.

---

## Étape 2 — Vérifier que les deux tâches sont bien posées, et endormies

Appliquer la migration `0089` crée les deux tâches **désactivées**. C'est délibéré : sans cela, appliquer la migration à 18 h ferait facturer **tout votre parc** à 03h15 le lendemain matin, sur des données que personne n'a encore relues. Une première nuit doit être choisie, pas subie.

Dans **SQL Editor** :

```sql
select jobname, schedule, active from cron.job where jobname like 'oasis-%';
```

Vous devez voir exactement deux lignes, toutes deux avec `active` = `false` :

| jobname | schedule | active |
|---|---|---|
| oasis-cycle-facturation | 15 3 * * * | false |
| oasis-relances | 30 6 * * * | false |

**Si vous ne voyez aucune ligne :** `pg_cron` n'était pas activée quand la migration est passée. Activez-la (étape 1) puis demandez que le seul bloc « § 10 » de `0089` soit rejoué — il est fait pour être rejoué sans dégât.

---

## Étape 3 — Le tour d'essai, puis l'armement

**Ne réveillez pas les tâches avant d'avoir fait le tour d'essai.** Il prend deux minutes et vous montre exactement ce qui partirait cette nuit.

### 3.a — Voir ce qui se passerait, sans que rien ne se passe

Dans **SQL Editor** :

```sql
begin;
select * from public.saas_run_billing_cycle();
rollback;
```

Le `rollback` de la dernière ligne **annule tout**. Vous voyez le résultat, et la base revient exactement comme avant : aucune facture émise, aucun numéro consommé.

Lisez la colonne `outcome` :

| Ce que vous lisez | Ce que ça veut dire |
|---|---|
| Aucune ligne | Rien n'est dû aujourd'hui. Normal si personne n'arrive à échéance. |
| `issued` | Une facture serait émise. C'est le cas normal. |
| `blocked` | La facture ne peut pas être émise — le plus souvent un numéro de TVA non validé, ou un client sans SIRET. **L'abonnement ne bouge pas et sera repris la nuit suivante.** Rien n'est perdu ; il faut compléter la fiche du client. |
| `failed` | Une erreur. La colonne `blocking_reason` en donne le motif en français. Là encore, rien n'a bougé pour ce client-là, et les autres ont été traités. |

> **Un client qui échoue n'arrête pas la nuit des autres.** Chaque abonnement est traité séparément : celui dont la fiche est incomplète est mis de côté avec son motif, et le reste du parc passe normalement.

### 3.b — Armer

Quand le tour d'essai vous convient :

```sql
select cron.alter_job(jobid, active := true) from cron.job where jobname like 'oasis-%';
```

C'est fait. La première nuit aura lieu à 03h15 UTC.

### 3.c — Tout arrêter, en urgence

Si quelque chose part de travers, une seule commande arrête tout, immédiatement :

```sql
select cron.alter_job(jobid, active := false) from cron.job where jobname like 'oasis-%';
```

Cela **suspend** les tâches sans rien détruire. Les échéances non traitées seront rattrapées quand vous réarmerez — la base rattrape **un mois par nuit**, jamais plusieurs d'un coup, ce qui vous laisse le temps de voir passer la première.

---

## Étape 4 — Vider les files : la clé de service, et où elle se dépose

Les tâches de nuit **déposent** du travail : « il faut relancer ce client », « il faut interroger le registre européen pour ce numéro ». Quelqu'un doit ensuite passer prendre ce travail et l'exécuter, parce que cela demande de sortir de la base.

Ce quelqu'un est une **fonction Edge** de Supabase, et pour être appelée elle exige la **clé de service** de votre projet — la clé la plus puissante qui existe chez vous.

### La règle absolue

**La clé de service ne s'écrit jamais dans la définition d'une tâche planifiée.**

Cette définition vit dans une table de la base, `cron.job`, que n'importe qui pouvant lire la base peut consulter. Y écrire la clé de service, c'est ranger la clé de la maison à côté de ce qu'elle protège. C'est le piège le plus courant de ce type de montage, et il n'émet aucun avertissement.

Vous pouvez vérifier à tout moment qu'aucune clé n'y est descendue :

```sql
select jobname, command from cron.job where jobname like 'oasis-%';
```

Les deux commandes doivent être du SQL nu — un `select` sur une fonction, rien d'autre. Aucune adresse internet, aucun mot ressemblant à `Bearer` ou à une clé.

### La voie recommandée : le planificateur de fonctions Edge

C'est la plus simple **et** la plus sûre, parce qu'aucune clé ne descend en base du tout.

1. **Supabase → Edge Functions**, ouvrez `relances-planifiees`.
2. Onglet **Schedules** (ou *Cron*), **Add schedule**.
3. Périodicité : toutes les quinze minutes (`*/15 * * * *`).
4. Supabase se charge de l'authentification lui-même. Vous n'avez **aucune clé à coller**.

Faites de même pour la fonction qui interroge le registre de TVA, quand elle sera déployée.

### Si vous devez malgré tout passer par la base

Dans ce cas seulement, la clé se dépose dans **Vault**, le coffre de Supabase — et **à la main, une seule fois**.

1. **Supabase → Project Settings → Vault**.
2. **Add new secret**.
3. Dans **Name**, mettez un nom parlant, par exemple `cle_service_oasis`.
4. Dans **Secret**, collez la clé de service, que vous trouverez dans **Project Settings → API**.
5. Enregistrez.

**Trois précautions, et elles comptent :**

- Ne collez la clé **que** dans cette case. Pas dans un message, pas dans un fichier, pas dans une conversation — y compris avec moi.
- Après avoir enregistré, **videz votre presse-papiers** en copiant n'importe quel autre texte.
- Vault vous montrera ensuite le **nom** du secret, jamais sa valeur. C'est normal, et c'est le but : la tâche va chercher la valeur au moment de s'exécuter, personne ne la relit.

> **Aucun exemple de clé ne figure dans cette notice, même fictif.** Un exemple se recopie, et une clé recopiée par erreur est une clé à révoquer. Si vous croyez qu'une clé a été exposée, même une seconde : allez la remplacer dans **Project Settings → API**. C'est gratuit et immédiat.

---

## Étape 5 — Vérifier que ça tourne vraiment

### Le coup d'œil de trente secondes

Une seule commande vous dit si tout va bien :

```sql
select * from public.saas_ordonnanceur_sante();
```

Elle répond en français. Trois cas :

| Réponse | Ce que ça veut dire | Quoi faire |
|---|---|---|
| « La facturation a abouti il y a *N* heures. Tout est normal. » | Tout va bien. | Rien. |
| « La facturation n'a pas abouti depuis *N* heures. » | **La facturation ne tourne plus.** Des factures ne partent pas, des essais restent ouverts. | Voir « Quand ça ne tourne pas » ci-dessous. |
| « La facturation n'a JAMAIS abouti depuis la mise en service. » | Soit vous venez d'armer et la première nuit n'a pas encore eu lieu, soit la tâche n'a jamais démarré. | Attendez le lendemain matin. Si le message persiste : « Quand ça ne tourne pas ». |

### Le détail des dernières nuits

```sql
select jobname, status, start_time, return_message
from cron.job_run_details
where jobname like 'oasis-%'
order by start_time desc
limit 20;
```

Vous devez voir une ligne par tâche et par nuit, avec `status` = `succeeded`.

### Ce qui a été fait, en français

```sql
select occurred_at, kind, label, details
from public.saas_machine_events
order by occurred_at desc
limit 50;
```

Les mots à reconnaître :

| `kind` | Ce que ça raconte |
|---|---|
| `billingCycle.finished` | Une nuit s'est terminée normalement. |
| `subscription.trialEnded` | Un essai s'est terminé, la première facture est partie. |
| `subscription.trialEndFailed` | Un essai n'a **pas** pu être facturé. **L'abonnement est resté en essai** et sera repris. Le motif est dans `details`. |
| `subscription.renewed` | Une échéance mensuelle a été facturée. |
| `subscription.renewalFailed` | Une échéance n'a pas pu être facturée. La période **n'a pas avancé** : le mois ne sera pas sauté. |
| `subscription.seatMismatch` | Le nombre de comptes en base ne correspond pas à ce qui a été encaissé. On facture ce qui a été encaissé, et l'écart se règle à l'échéance suivante. |
| `billingCycle.missing` | **Une nuit a manqué.** Voir ci-dessous. |

---

## Ce qui se passe le jour où l'ordonnanceur s'arrête

**Il faut le savoir : ce n'est pas bruyant.** Une tâche planifiée qui ne tourne plus ne provoque aucune erreur, aucun écran rouge, aucun courriel. Tout a simplement l'air normal — jusqu'à ce qu'un client s'étonne de n'avoir jamais été prélevé, ou qu'un essai gratuit dure depuis six mois.

### Ce qui se casse, dans l'ordre

1. **Les essais ne se terminent plus.** Un client reste en essai gratuit indéfiniment : il utilise le produit, sa carte est enregistrée, et rien n'est jamais débité.
2. **Les factures mensuelles ne partent plus.** Les périodes n'avancent pas.
3. **Les relances ne partent plus.** Les devis sans réponse restent sans réponse, les impayés restent impayés.

**Rien n'est perdu.** Toutes ces échéances sont rattrapées au redémarrage, **une par nuit et par client**. Un arrêt de trois jours se rattrape donc en trois nuits, sans salve.

### Comment vous en apercevoir AVANT qu'un client s'en plaigne

C'est le rôle de la fonction de veille, et voici comment elle fonctionne — parce que le mécanisme explique sa limite.

Les traces « la nuit a commencé » et « la nuit s'est terminée » vivent **dans la même opération** que le travail. Une nuit qui échoue annule donc aussi sa propre trace : il ne reste rien, pas même la preuve qu'on a essayé. C'est pourquoi une seule tâche ne peut pas se surveiller elle-même.

**Les deux tâches se surveillent donc l'une l'autre.** À 06h30, la tâche des relances vérifie que celle de 03h15 a abouti. Si le dernier succès remonte à plus de **36 heures**, elle écrit une alerte `billingCycle.missing` — depuis sa propre opération, qui survit.

> Trente-six heures et non vingt-quatre : une nuit sautée peut être un simple redémarrage de serveur. Deux nuits sautées, non.

**Votre routine :** une fois par semaine, lancez la commande de l'étape 5. Trente secondes. Si elle dit « tout est normal », vous n'avez rien à faire.

Pour voir les alertes accumulées :

```sql
select occurred_at, details
from public.saas_machine_events
where kind = 'billingCycle.missing'
order by occurred_at desc;
```

Aucune ligne = aucune nuit manquée depuis la mise en service.

### Quand ça ne tourne pas — les cinq causes, dans l'ordre où les vérifier

**1. Les tâches sont-elles armées ?** C'est de loin la cause la plus fréquente, puisqu'elles sont posées endormies.

```sql
select jobname, active from cron.job where jobname like 'oasis-%';
```

`active` doit valoir `true`. Sinon, étape 3.b.

**2. `pg_cron` est-elle toujours activée ?**

```sql
select count(*) from pg_extension where extname = 'pg_cron';
```

Doit valoir `1`. Une restauration de sauvegarde peut la désactiver.

**3. Les tâches échouent-elles ?**

```sql
select jobname, status, start_time, return_message
from cron.job_run_details
where jobname like 'oasis-%' and status <> 'succeeded'
order by start_time desc limit 10;
```

`return_message` porte l'erreur. Notez-la avant de demander de l'aide : elle dit presque toujours ce qui manque.

**4. La base a-t-elle été mise en pause ?** Un projet Supabase inactif se met en veille, et les tâches planifiées avec lui. Le bandeau du tableau de bord le dit.

**5. La tâche tourne mais rien ne se produit.** C'est normal s'il n'y a rien à faire. Vérifiez que quelque chose est réellement dû :

```sql
select count(*) as essais_a_terminer
from public.organization_subscriptions
where status = 'trialing' and trial_ends_at::date <= current_date;
```

---

## Les relances : pourquoi elles ne partent peut-être pas

Deux réglages les gouvernent, et ils sont **désactivés par défaut**, entreprise par entreprise. C'est voulu : on n'écrit pas aux clients de quelqu'un sans qu'il l'ait demandé.

```sql
select organization_id, reminders_enabled, reminder_delay_days, reminder_max
from public.email_organization_settings;
```

- `reminders_enabled` = `false` → aucune relance ne partira pour cette entreprise.
- `reminder_delay_days` → le délai entre deux relances (7 par défaut).
- `reminder_max` → combien de relances au maximum (2 par défaut).

**La cadence part de la dernière relance réellement partie**, pas de l'envoi initial du devis. C'est ce qui garantit sept jours d'écart entre chaque, y compris le jour où vous activez les relances sur un portefeuille de vieux devis — sans quoi tout un stock de relances partirait en trois jours.

**Un courriel qui rebondit ne compte pas comme une relance faite.** Le client dont l'adresse est mauvaise n'a rien reçu : son rang n'avance pas.

---

## Le mémo — à garder sous la main

| Je veux… | La commande |
|---|---|
| Savoir si tout va bien | `select * from public.saas_ordonnanceur_sante();` |
| Voir si les tâches sont armées | `select jobname, active from cron.job where jobname like 'oasis-%';` |
| **Tout arrêter maintenant** | `select cron.alter_job(jobid, active := false) from cron.job where jobname like 'oasis-%';` |
| Tout relancer | `select cron.alter_job(jobid, active := true) from cron.job where jobname like 'oasis-%';` |
| Voir ce qui partirait, sans rien envoyer | `begin; select * from public.saas_run_billing_cycle(); rollback;` |
| Voir les dernières nuits | `select jobname, status, start_time, return_message from cron.job_run_details where jobname like 'oasis-%' order by start_time desc limit 20;` |
| Vérifier qu'aucune clé n'est en base | `select jobname, command from cron.job where jobname like 'oasis-%';` |

---

## Les trois choses à retenir

1. **Les tâches sont posées endormies.** Tant que vous ne les armez pas (étape 3.b), rien ne part. La première nuit se choisit.
2. **La clé de service ne descend jamais dans `cron.job`.** Elle va dans Vault, à la main, une seule fois — ou nulle part du tout si vous employez le planificateur de fonctions Edge, qui est la voie recommandée.
3. **Un ordonnanceur arrêté est silencieux.** C'est pour cela que les deux tâches se surveillent l'une l'autre, et que le coup d'œil hebdomadaire de l'étape 5 vaut la peine. Trente secondes par semaine, contre un client qui découvre six mois plus tard qu'il n'a jamais été prélevé.
