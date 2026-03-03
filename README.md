# Standalone Planning Poker

Produit autonome de planning poker (backend TypeScript + frontend Vue) dans un sous-répertoire du repo principal.

## Structure

- `backend`: API Fastify TypeScript, Prisma, JWT, OIDC, sessions planning poker, intégration Jira Cloud.
- `frontend`: application Vue 3 (login, création/rejoindre session, vue de session, profil utilisateur).
- `docker-compose.dev.yml`: dépendances de dev (PostgreSQL).
- `docker-compose.yml`: déploiement production via image registry.
- `Dockerfile`: build multi-stage backend + frontend.

## Démarrage local

1. Lancer PostgreSQL:

```bash
docker compose -f standalone-planning-poker/docker-compose.dev.yml up -d
```

2. Préparer et lancer le backend:

```bash
cd standalone-planning-poker/backend
cp .env.example .env
npm install
npx prisma generate
npx prisma migrate dev
npm run dev
```

3. Lancer le frontend:

```bash
cd standalone-planning-poker/frontend
npm install
npm run dev
```

Frontend: `http://localhost:5174`  
Backend: `http://localhost:3333`

## URLs frontend

- Session canonique: `/session/:code`
- Ancienne URL encore supportée: `/sessions/:id` (redirection vers URL canonique)
- Ancienne URL d’invitation: `/join/:code` (redirection vers `/session/:code`)

## Variables d’environnement backend importantes

- Auth: `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `JWT_ACCESS_TTL`, `JWT_REFRESH_TTL_DAYS`, `REFRESH_COOKIE_NAME`
- OIDC: `OIDC_ENABLED`, `OIDC_ISSUER_URL`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_REDIRECT_URI`, `OIDC_TRANSPARENT_LOGIN`
  - Login transparent: `OIDC_TRANSPARENT_LOGIN=true` (par défaut). Quand OIDC est activé, la page de login lance automatiquement l’authentification SSO.
  - TLS/CA interne: `OIDC_CA_CERT_PATH` (chemin vers le certificat ou bundle CA à faire confiance)
  - Débogage local uniquement: `OIDC_TLS_INSECURE=true` (désactive la vérification TLS pour les appels OIDC sortants)
- Session: `AUTO_CLOSE_AFTER_MS`, `CLOSING_DURATION_MS`
- Jira:
  - `JIRA_CREDENTIALS_ENCRYPTION_KEY` (obligatoire, sert à chiffrer le token Jira utilisateur en base)
  - `JIRA_DEFAULT_STORY_POINTS_FIELD_ID` (mapping story points par défaut, ex: `customfield_10016`)

## Jira: fonctionnement actuel

- Les credentials Jira sont saisis par chaque utilisateur dans `Mon Profil`:
  - Jira base url
  - Jira email
  - Jira token
- Le token Jira est stocké chiffré en base.
- Lors de la sauvegarde du profil:
  - test Jira obligatoire
  - mise à jour du profil utilisateur (nom + Jira)
- Tant que l’utilisateur n’a pas de credentials Jira, il ne peut pas créer de session.
- Lors de la création d’une session, un snapshot Jira est enregistré dans la session.
- Les mises à jour Jira des tickets pendant la session utilisent ce snapshot, même si l’hôte quitte la session.
- Les variables d’environnement `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN` ne sont plus utilisées.

## Fonctionnalités principales

- Auth locale JWT + refresh token en cookie `httpOnly`.
- OIDC Keycloak activable (auto-inscription).
- Session planning poker:
  - création
  - rejoindre par code
  - vote / reveal / restart / skip
  - assignation de story points Jira
  - transfert automatique de l’hôte si l’hôte quitte
  - observateur/votant
  - réactions emoji temps réel
- Heartbeat participant:
  - ping frontend toutes les 10s
  - retrait automatique d’un participant après 60s sans ping
- Socket.IO pour synchronisation temps réel.
- Intégration Jira Cloud:
  - projets
  - statuts
  - tickets par projet/statut
  - ajout ticket par clé
  - lecture description ticket
- Admin:
  - mapping du champ story points par projet
  - configuration OIDC

## Notes migration / Prisma

- Après une évolution de schéma Prisma, exécuter:
  - `npx prisma migrate dev`
  - `npx prisma generate`
- Sur Windows, si `prisma generate` échoue avec `EPERM ... query_engine...dll`, arrêter les process Node qui utilisent Prisma (ex: `npm run dev`) puis relancer.
