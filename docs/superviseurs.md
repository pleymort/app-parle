# Architecture — rôle superviseur (parent · orthophoniste · école)

Document de conception. À valider avant d'écrire du code.

## 1. Pourquoi

Deux analyses indépendantes convergent : la **plateforme multi-aidants** est
l'espace laissé vacant par CoughDrop que personne n'a repris, elle est alignée
avec les recommandations HAS 2026 sur la « cohérence entre les environnements »,
et c'est le meilleur canal d'acquisition du secteur (une orthophoniste qui
adopte amène ses patients).

Concrètement, trois besoins réels :

1. L'orthophoniste **modifie le vocabulaire depuis son poste**, sans confisquer
   la tablette de l'enfant.
2. Elle a **le même tableau sur SA tablette** pour faire du modelage en séance.
3. L'AESH et l'école voient ce que l'enfant utilise, et laissent des notes.

## 2. Le verrou architectural actuel

Aujourd'hui **le compte EST l'enfant** : la sauvegarde vit dans
`gs://leova-app-sync/{uid}.json`, et `users/{uid}.plan` porte l'abonnement.
Tant que c'est le cas, partager l'accès revient à partager le mot de passe —
inacceptable.

Il faut séparer trois notions :

| Notion | Ce que c'est | Identifiant |
|---|---|---|
| **Compte** | une personne (parent, orthophoniste, AESH) | `uid` Firebase |
| **Profil** | un enfant, son vocabulaire, ses réglages | `pid` |
| **Accès** | un compte × un profil × un rôle | membre |

Cette séparation débloque aussi, gratuitement, le multi-profils (fratrie) et
l'orthophoniste qui suit 15 patients depuis une seule tablette.

## 3. Modèle de données

### Firestore

```
accounts/{uid}          { email, plan, createdAt }        # ex-users/{uid}
profiles/{pid}          { name, ownerUid, lang, createdAt }
profiles/{pid}/members/{uid}
                        { role, scopes, invitedBy, acceptedAt }
profiles/{pid}/notes/{noteId}
                        { authorUid, text, createdAt }    # carnet de liaison
invites/{code}          { pid, role, scopes, createdBy, expiresAt, usedBy }
```

### Cloud Storage

```
gs://leova-app-sync/profiles/{pid}.json     # vocabulaire (aujourd'hui : {uid}.json)
gs://leova-app-sync/journals/{pid}.json     # journal d'usage — UNIQUEMENT si partagé
```

### Rôles

| Rôle | Vocabulaire | Journal | Notes | Inviter | Facturation |
|---|---|---|---|---|---|
| **owner** (parent) | modifier | voir | écrire | oui | oui |
| **editor** (orthophoniste) | modifier | voir *si accordé* | écrire | non | non |
| **viewer** (AESH, grands-parents) | voir + modeler | non par défaut | écrire | non | non |

`scopes` est explicite et granulaire : `{ vocab: true, journal: false, notes: true }`.
Le journal est **hors périmètre par défaut**, y compris pour un editor.

## 4. Parcours d'invitation

**Côté parent** — mode parent → Compte → « Inviter un professionnel » :
1. choisir le rôle (modifier / consulter)
2. cocher ce que la personne peut voir (le journal est **décoché** par défaut)
3. l'app affiche un **code à 6 caractères** + un lien, valable **7 jours**,
   à usage unique
4. la liste des personnes ayant accès est visible en permanence, avec la date
   et un bouton **Retirer l'accès** à effet immédiat

**Côté professionnel** :
1. installe Leova, crée un compte **gratuit** (jamais d'abonnement pour un
   superviseur — c'est le modèle du « supporter account » de CoughDrop, et
   c'est ce qui rend l'adoption possible)
2. saisit le code → l'enfant apparaît dans sa liste de profils
3. bascule d'un enfant à l'autre depuis sa propre tablette

**Le modelage boucle la boucle** : quand le professionnel utilise le profil
d'un enfant sur SA tablette, l'app force le mode modelage (v50). Ses appuis
n'entrent jamais dans les statistiques de l'enfant. C'est précisément
pourquoi v50 devait passer en premier.

## 5. API

Toutes les vérifications d'appartenance se font **côté serveur** (Cloud Run
valide déjà les jetons Firebase). Le client n'est jamais l'autorité.

```
GET    /v1/profiles                 → profils accessibles + rôle
POST   /v1/profiles                 → créer un profil (owner)
GET    /v1/sync?pid=…               → lire le vocabulaire   (scope vocab)
POST   /v1/sync?pid=…               → écrire le vocabulaire (role owner|editor)
POST   /v1/invites                  → créer un code         (owner)
POST   /v1/invites/{code}/accept    → rejoindre un profil
GET    /v1/profiles/{pid}/members   → qui a accès           (owner)
DELETE /v1/profiles/{pid}/members/{uid} → révoquer          (owner)
GET/POST /v1/profiles/{pid}/notes   → carnet de liaison     (scope notes)
GET    /v1/profiles/{pid}/journal   → journal               (scope journal)
```

## 6. Le point dur : les écritures concurrentes

La synchro actuelle est **« dernier écrivain gagne » sur tout le blob**. Avec
un parent et une orthophoniste qui modifient en même temps, l'un écrase
silencieusement le travail de l'autre. Inacceptable dès qu'on ouvre l'accès.

Correctif minimal : **écriture conditionnelle**. Le client envoie la `rev`
qu'il a lue ; si elle ne correspond plus, le serveur répond **409** et le
client refait un pull puis rejoue sa modification. GCS le permet nativement
via `ifGenerationMatch`.

Correctif complet (plus tard) : passer d'un blob unique à des entités
adressables (une carte = un document), pour que deux personnes puissent
modifier deux cartes différentes sans conflit.

## 7. RGPD — les décisions à assumer

On traite des données d'un **enfant mineur**, et le simple fait d'utiliser une
app de CAA **révèle un handicap** : c'est une donnée sensible (art. 9 RGPD).
Partager ces données avec un tiers professionnel n'est pas anodin.

| Sujet | Décision |
|---|---|
| **Base légale** | Consentement explicite du titulaire de l'autorité parentale, recueilli à chaque invitation, horodaté et conservé |
| **Minimisation** | Périmètres séparés ; le journal n'est jamais partagé par défaut, même pour un editor |
| **Le journal reste local tant qu'il n'est pas partagé** | Aujourd'hui il ne quitte jamais la tablette. On ne téléverse QUE si le parent coche explicitement le partage, pour un profil et une personne donnés |
| **Transparence** | Le parent voit en permanence qui a accès, à quoi, depuis quand |
| **Révocation** | Immédiate, sans délai de propagation ; le professionnel perd l'accès à la seconde |
| **Effacement** | Supprimer un profil purge le blob, le journal, les notes et toutes les appartenances |
| **Conservation** | Codes d'invitation 7 jours ; journal partagé purgé après 12 mois glissants |
| **L'enfant n'a jamais de compte** | Il n'est pas utilisateur, il est sujet des données. À conserver tel quel |
| **Sous-traitance** | Google Cloud, région UE — déjà le cas. À expliciter dans la politique de confidentialité |
| **Point à instruire** | Si des orthophonistes l'utilisent à titre professionnel, Leova devient potentiellement leur sous-traitant : il faudra un contrat type (DPA). À faire regarder par un juriste avant le canal B2B |

La politique de confidentialité publiée doit être mise à jour **avant** la
mise en service, pas après.

## 8. Facturation

L'abonnement Plus s'attache au **profil**, payé par le parent. Un superviseur
n'a **jamais** besoin d'abonnement, quel que soit le nombre d'enfants qu'il
suit. Sans cette règle, aucune orthophoniste n'adopte l'outil.

Un palier « Pro » séparé pourra exister plus tard pour des fonctions qui lui
sont propres (tableau de bord multi-patients, rapports agrégés) — mais l'accès
de base aux enfants qui l'ont invitée reste gratuit.

## 9. Migration — sans rien casser

1. **Backend tolérant** : à la première requête authentifiée, si
   `profiles/p_{uid}` n'existe pas, le créer, y copier `{uid}.json`, et poser
   le membre `owner`. L'ancien chemin reste lisible plusieurs mois.
2. **App** : mémorise un `pid` courant, par défaut `p_{uid}`. Aucun changement
   visible pour les utilisateurs existants.
3. **Bascule** : quand tous les clients actifs envoient un `pid`, retirer la
   lecture de l'ancien chemin.

## 10. Découpage proposé

| Phase | Contenu | Visible ? | Poids |
|---|---|---|---|
| **A** | Abstraction profil + migration + écriture conditionnelle (409) | non | moyen |
| **B** | Invitation, rôle **viewer**, compte superviseur gratuit, modelage forcé | oui — l'orthophoniste a le tableau sur sa tablette | moyen |
| **C** | Rôle **editor** : modification à distance (réutilise la synchro vivante v47) | oui — elle modifie depuis son poste | petit |
| **D** | Partage du journal (opt-in) + carnet de liaison + rapports | oui | moyen, et c'est la phase RGPD |

**Phase A d'abord, même si rien n'est visible.** C'est elle qui contient le
risque technique (migration, conflits) ; la livrer seule permet de la vérifier
en production sans exposer de données partagées.

**Phase B apporte déjà l'essentiel de la valeur d'adoption** : le professionnel
a le vocabulaire de l'enfant sur sa propre tablette, gratuitement.

## 11. Ce qui reste à trancher (décisions produit)

1. Un superviseur peut-il **inviter** un autre superviseur ? *Proposition : non,
   seul le parent invite. Plus simple, plus sûr, et le parent garde la main.*
2. Que voit un superviseur des **autres superviseurs** ? *Proposition : la liste
   des prénoms et rôles, pour que l'équipe se connaisse.*
3. **Deux parents séparés** avec des tablettes différentes : deux owners sur un
   même profil ? *Proposition : oui, un profil peut avoir plusieurs owners.*
4. Le professionnel peut-il **exporter** le vocabulaire (.obz) ? *Proposition :
   oui pour un editor, non pour un viewer.*
