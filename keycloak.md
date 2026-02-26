# Configuration Keycloak pour Standalone Planning Poker

Ce guide configure Keycloak pour l'application avec une seule URL publique :
- Frontend sur `/`
- Backend API sur `/api`
- Callback OIDC sur `/api/auth/oidc/callback`

## 1. Pré-requis

- Une instance Keycloak accessible en HTTPS (recommandé en production).
- L'URL publique de l'application, par exemple : `https://poker.example.com`.
- Le backend de l'application déployé et joignable.

## 2. Créer le Realm

1. Ouvrir l'admin Keycloak.
2. Créer un Realm (ex: `planning-poker`).

## 3. Créer le Client OIDC

1. Aller dans `Clients` puis `Create client`.
2. `Client type`: `OpenID Connect`.
3. `Client ID`: par exemple `planning-poker-web`.
4. Sauvegarder.

Dans les paramètres du client :

1. `Access type` / `Client authentication`: activer l'authentification client (client confidentiel).
2. `Standard flow`: activé.
3. `Direct access grants`: désactivé (optionnel, recommandé).
4. `Valid redirect URIs` :
   - `https://poker.example.com/api/auth/oidc/callback`
   - en dev, ajouter aussi `http://localhost:3333/api/auth/oidc/callback`
5. `Web origins` :
   - `https://poker.example.com`
   - en dev, `http://localhost:3333` (ou `+` selon votre politique)
6. `Root URL` / `Home URL` (optionnel mais conseillé) :
   - `https://poker.example.com`

## 4. Vérifier les claims utilisateur

L'application exige un email OIDC.

Vérifier côté Keycloak que les claims suivants sont présents dans `userinfo` :
- `email` (obligatoire)
- `name` (recommandé)
- `preferred_username` (recommandé)

Si `email` n'est pas fourni, la connexion échouera avec `OIDC_EMAIL_MISSING`.

## 5. Récupérer les infos à injecter dans l'app

Depuis le client Keycloak :
- `issuer URL` (realm)
  - exemple: `https://keycloak.example.com/realms/planning-poker`
- `client id`
- `client secret`

## 6. Configurer le backend

Dans `backend/.env` :

```env
OIDC_ENABLED=true
OIDC_ISSUER_URL=https://keycloak.example.com/realms/planning-poker
OIDC_CLIENT_ID=planning-poker-web
OIDC_CLIENT_SECRET=xxxxxxxxxxxxxxxx
OIDC_REDIRECT_URI=https://poker.example.com/api/auth/oidc/callback
APP_BASE_URL=https://poker.example.com
```

Notes :
- `APP_BASE_URL` doit pointer vers l'URL publique racine du frontend.
- `OIDC_REDIRECT_URI` doit correspondre exactement à la callback backend.

## 7. Configurer via l'UI Admin de l'application (optionnel)

L'application expose aussi une configuration OIDC admin :
- `GET /api/admin/oidc/config`
- `PUT /api/admin/oidc/config`

Tu peux donc gérer OIDC soit par `.env`, soit via l'écran admin (persisté en base).

## 8. Tester le flux

1. Ouvrir `https://poker.example.com/login`.
2. Cliquer sur `Se connecter avec Keycloak`.
3. Vérifier la redirection vers Keycloak.
4. Après login, vérifier le retour sur l'app.

Endpoints utiles :
- démarrage login: `/api/auth/oidc/login`
- callback: `/api/auth/oidc/callback`

## 9. Points d'attention en production

- Utiliser HTTPS (cookies sécurisés en production).
- Vérifier que la date/heure serveur est correcte (sinon erreurs de token).
- Si reverse proxy, conserver correctement les en-têtes `X-Forwarded-*`.
- Les utilisateurs créés via OIDC arrivent avec le rôle applicatif `USER` par défaut (promotion admin à gérer côté application/base).

## 10. Exemples rapides

### Local (backend seul sur 3333)

- App: `http://localhost:3333`
- Redirect URI: `http://localhost:3333/api/auth/oidc/callback`

### Production (single domain)

- App: `https://poker.example.com`
- Redirect URI: `https://poker.example.com/api/auth/oidc/callback`
