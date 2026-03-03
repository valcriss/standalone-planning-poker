<template>
  <main class="layout">
    <div class="card" style="max-width: 520px; margin: 40px auto">
      <h1>Connexion</h1>
      <p>Connectez-vous pour créer ou rejoindre une session planning poker.</p>

      <div v-if="oidcEnabled" style="display: grid; gap: 12px">
        <p>L’authentification locale est désactivée. Utilisez votre compte SSO.</p>
        <button type="button" @click="startOidcLogin">Se connecter avec Keycloak</button>
      </div>

      <form v-else style="display: grid; gap: 12px" @submit.prevent="submit">
        <input v-model="email" type="email" placeholder="Email" required />
        <input v-if="mode === 'register'" v-model="displayName" placeholder="Nom affiché" required />
        <input v-model="password" type="password" placeholder="Mot de passe" required />
        <button type="submit">{{ mode === 'register' ? "Créer un compte" : "Se connecter" }}</button>
        <button class="secondary" type="button" @click="toggleMode">
          {{ mode === 'register' ? 'J’ai déjà un compte' : 'Créer un compte' }}
        </button>
      </form>

      <p v-if="error" style="color: #a32121; margin-top: 12px">{{ error }}</p>
    </div>
  </main>
</template>

<script setup lang="ts">
/* istanbul ignore file */
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import { api } from '../services/api';

const router = useRouter();
const route = useRoute();
const authStore = useAuthStore();

const email = ref('');
const displayName = ref('');
const password = ref('');
const mode = ref<'login' | 'register'>('login');
const error = ref('');
const oidcEnabled = ref(false);
const oidcTransparentLogin = ref(true);

const getRedirectTarget = () => {
  const redirect = route.query.redirect;
  if (typeof redirect !== 'string') {
    return '/';
  }

  return redirect.startsWith('/') ? redirect : '/';
};

const toggleMode = () => {
  mode.value = mode.value === 'login' ? 'register' : 'login';
  error.value = '';
};

const submit = async () => {
  error.value = '';

  try {
    if (mode.value === 'register') {
      await authStore.register({
        email: email.value,
        displayName: displayName.value,
        password: password.value,
      });
    } else {
      await authStore.login({
        email: email.value,
        password: password.value,
      });
    }

    await router.push(getRedirectTarget());
  } catch (err) {
    error.value = 'Authentification impossible. Vérifiez vos informations.';
    // eslint-disable-next-line no-console
    console.error(err);
  }
};

const startOidcLogin = () => {
  const redirect = encodeURIComponent(getRedirectTarget());
  window.location.assign(`/api/auth/oidc/login?redirect=${redirect}`);
};

onMounted(async () => {
  const code = route.query.code;
  const state = route.query.state;

  if (typeof code === 'string' && typeof state === 'string' && code && state) {
    const callbackParams = new URLSearchParams({ code, state });
    window.location.assign(`/api/auth/oidc/callback?${callbackParams.toString()}`);
    return;
  }

  const { data } = await api.get('/auth/oidc/config');
  oidcEnabled.value = !!data.enabled;
  oidcTransparentLogin.value = data.transparentLogin !== false;

  if (oidcEnabled.value && oidcTransparentLogin.value) {
    startOidcLogin();
  }
});
</script>
