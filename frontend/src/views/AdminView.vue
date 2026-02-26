<template>
  <main class="layout" style="display: grid; gap: 20px">
    <header style="display: flex; justify-content: space-between; align-items: center">
      <h1>Administration</h1>
      <button class="secondary" @click="goHome">Retour</button>
    </header>

    <section class="card" style="display: grid; gap: 12px">
      <h2>Configuration Jira</h2>
      <input v-model="jira.baseUrl" placeholder="https://your-domain.atlassian.net" />
      <input v-model="jira.email" placeholder="Email compte technique Jira" />
      <input v-model="jira.apiToken" type="password" placeholder="API token Jira (laisser vide pour conserver)" />
      <input v-model="jira.defaultStoryPointsFieldId" placeholder="customfield_10016" />
      <textarea
        v-model="jiraMappingsText"
        rows="6"
        placeholder="Mappings projet, format: PROJ=customfield_12345 (une ligne par projet)"
      />
      <button @click="saveJira">Enregistrer Jira</button>
    </section>

    <section class="card" style="display: grid; gap: 12px">
      <h2>Configuration OIDC (Keycloak)</h2>
      <label style="display: flex; align-items: center; gap: 8px">
        <input v-model="oidc.enabled" type="checkbox" style="width: auto" />
        Activer OIDC (désactive login/mot de passe local)
      </label>
      <input v-model="oidc.issuerUrl" placeholder="Issuer URL (realm Keycloak)" />
      <input v-model="oidc.clientId" placeholder="Client ID" />
      <input v-model="oidc.clientSecret" type="password" placeholder="Client Secret" />
      <input v-model="oidc.redirectUri" placeholder="Redirect URI (ex: http://localhost:3333/api/auth/oidc/callback)" />
      <button @click="saveOidc">Enregistrer OIDC</button>
    </section>

    <p v-if="message" style="color: #166d2a">{{ message }}</p>
    <p v-if="error" style="color: #a32121">{{ error }}</p>
  </main>
</template>

<script setup lang="ts">
/* istanbul ignore file */
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../services/api';

const router = useRouter();

const jira = ref({
  baseUrl: '',
  email: '',
  apiToken: '',
  defaultStoryPointsFieldId: '',
});
const jiraMappingsText = ref('');

const oidc = ref({
  enabled: false,
  issuerUrl: '',
  clientId: '',
  clientSecret: '',
  redirectUri: '',
});

const message = ref('');
const error = ref('');

const load = async () => {
  error.value = '';
  message.value = '';

  const jiraResponse = await api.get('/admin/jira/field-mappings');
  const jiraConfig = jiraResponse.data.config;

  jira.value.baseUrl = jiraConfig.baseUrl ?? '';
  jira.value.email = jiraConfig.email ?? '';
  jira.value.defaultStoryPointsFieldId = jiraConfig.defaultStoryPointsFieldId ?? '';
  jira.value.apiToken = '';

  const mappings = jiraConfig.projectFieldMappings || {};
  jiraMappingsText.value = Object.entries(mappings)
    .map(([projectKey, fieldId]) => `${projectKey}=${fieldId}`)
    .join('\n');

  const oidcResponse = await api.get('/admin/oidc/config');
  const oidcConfig = oidcResponse.data.config;

  oidc.value.enabled = !!oidcConfig.enabled;
  oidc.value.issuerUrl = oidcConfig.issuerUrl ?? '';
  oidc.value.clientId = oidcConfig.clientId ?? '';
  oidc.value.clientSecret = oidcConfig.clientSecret ?? '';
  oidc.value.redirectUri = oidcConfig.redirectUri ?? '';
};

const parseMappings = () => {
  const mapping: Record<string, string> = {};
  jiraMappingsText.value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => {
      const [projectKey, fieldId] = line.split('=');
      if (projectKey && fieldId) {
        mapping[projectKey.trim().toUpperCase()] = fieldId.trim();
      }
    });

  return mapping;
};

const saveJira = async () => {
  try {
    await api.put('/admin/jira/field-mappings', {
      baseUrl: jira.value.baseUrl || undefined,
      email: jira.value.email || undefined,
      apiToken: jira.value.apiToken || undefined,
      defaultStoryPointsFieldId: jira.value.defaultStoryPointsFieldId || undefined,
      projectFieldMappings: parseMappings(),
    });

    message.value = 'Configuration Jira enregistrée.';
    error.value = '';
    jira.value.apiToken = '';
    await load();
  } catch {
    error.value = 'Échec de sauvegarde Jira.';
    message.value = '';
  }
};

const saveOidc = async () => {
  try {
    await api.put('/admin/oidc/config', {
      enabled: oidc.value.enabled,
      issuerUrl: oidc.value.issuerUrl || undefined,
      clientId: oidc.value.clientId || undefined,
      clientSecret: oidc.value.clientSecret || undefined,
      redirectUri: oidc.value.redirectUri || undefined,
    });

    message.value = 'Configuration OIDC enregistrée.';
    error.value = '';
    await load();
  } catch {
    error.value = 'Échec de sauvegarde OIDC.';
    message.value = '';
  }
};

const goHome = async () => {
  await router.push('/');
};

onMounted(async () => {
  await load();
});
</script>
