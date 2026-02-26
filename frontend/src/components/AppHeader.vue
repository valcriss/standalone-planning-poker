<template>
  <header class="appHeader">
    <div class="headerSide" />
    <h1 class="appTitle">Cnaving Poker</h1>
    <div class="headerSide right">
      <div class="avatarMenuWrap">
        <button class="avatarButton" type="button" aria-label="Menu utilisateur" @click="toggleMenu">
          <img v-if="authStore.user?.avatarDataUrl" :src="authStore.user.avatarDataUrl" alt="Avatar utilisateur" />
          <span v-else>{{ initials }}</span>
        </button>
        <div v-if="isMenuOpen" class="userMenu">
          <button v-if="authStore.user?.role === 'ADMIN'" type="button" class="userMenuItem" @click="goAdmin">
            Administration
          </button>
          <button type="button" class="userMenuItem" @click="openProfile">Mon Profil</button>
          <button type="button" class="userMenuItem danger" @click="logout">Déconnexion</button>
        </div>
      </div>
    </div>
  </header>

  <div v-if="isProfileOpen" class="dialogOverlay" @click.self="cancelProfile">
    <div class="dialogCard">
      <div class="dialogHeader">
        <h2>Mon Profil</h2>
      </div>

      <div class="profileGrid">
        <div class="avatarColumn">
          <div class="profileAvatar">
            <img v-if="authStore.user?.avatarDataUrl" :src="authStore.user.avatarDataUrl" alt="Avatar utilisateur" />
            <span v-else>{{ initials }}</span>
          </div>
          <div class="avatarActions">
            <input ref="avatarInput" type="file" accept="image/*" class="hiddenInput" @change="onAvatarPicked" />
            <button type="button" :disabled="isAvatarSaving || isProfileSaving || isTestingJira" @click="pickAvatarFile">
              {{ isAvatarSaving ? 'Enregistrement...' : 'Uploader un avatar' }}
            </button>
            <button
              type="button"
              class="secondary"
              :disabled="isAvatarSaving || isProfileSaving || isTestingJira || !authStore.user?.avatarDataUrl"
              @click="removeAvatar"
            >
              Supprimer l'avatar
            </button>
          </div>
        </div>

        <div class="profileFormWrap">
          <div class="profileForm">
            <label for="profile-email">Email</label>
            <input id="profile-email" type="text" :value="authStore.user?.email || ''" readonly />

            <label for="profile-name">Nom utilisateur</label>
            <input id="profile-name" v-model="profileDisplayName" type="text" :readonly="oidcEnabled" />

            <label for="jira-base-url">Jira base url</label>
            <input id="jira-base-url" v-model="jiraBaseUrl" type="text" placeholder="https://company.atlassian.net" />

            <label for="jira-email">Jira email</label>
            <input id="jira-email" v-model="jiraEmail" type="email" placeholder="email@company.com" />

            <label for="jira-token">Jira token</label>
            <input
              id="jira-token"
              v-model="jiraToken"
              type="password"
              :placeholder="hasStoredJiraToken ? 'Laisser vide pour conserver le token actuel' : 'Entrer votre token Jira'"
            />

            <button type="button" class="secondary" :disabled="isProfileSaving || isTestingJira || isAvatarSaving" @click="testJiraCredentials">
              <span v-if="isTestingJira" class="inlineSpinner" />
              {{ isTestingJira ? 'Test en cours...' : 'Tester la connexion Jira' }}
            </button>
          </div>
        </div>
      </div>

      <p v-if="errorText" class="errorText">{{ errorText }}</p>
      <p v-if="successText" class="successText">{{ successText }}</p>

      <div class="dialogFooter">
        <button type="button" class="secondary" :disabled="isProfileSaving || isTestingJira || isAvatarSaving" @click="cancelProfile">
          Annuler
        </button>
        <button type="button" :disabled="isProfileSaving || isTestingJira || isAvatarSaving" @click="saveProfile">
          <span v-if="isProfileSaving" class="inlineSpinner" />
          {{ isProfileSaving ? 'Veuillez patientez...' : 'Sauvegarder' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/* istanbul ignore file */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../services/api';
import { useAuthStore } from '../stores/auth';

const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();

const isMenuOpen = ref(false);
const isProfileOpen = ref(false);
const isAvatarSaving = ref(false);
const isProfileSaving = ref(false);
const isTestingJira = ref(false);
const errorText = ref('');
const successText = ref('');
const avatarInput = ref<HTMLInputElement | null>(null);
const profileDisplayName = ref('');
const oidcEnabled = ref(false);
const jiraBaseUrl = ref('');
const jiraEmail = ref('');
const jiraToken = ref('');
const hasStoredJiraToken = ref(false);

const initials = computed(() => {
  const name = authStore.user?.displayName || '?';
  return name
    .split(' ')
    .map((part) => part[0] || '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
});

const toggleMenu = () => {
  isMenuOpen.value = !isMenuOpen.value;
};

const closeMenu = () => {
  isMenuOpen.value = false;
};

const hydrateProfileForm = async () => {
  profileDisplayName.value = authStore.user?.displayName || '';
  jiraToken.value = '';
  successText.value = '';
  errorText.value = '';

  const [oidcResponse, jiraResponse] = await Promise.all([
    api.get('/auth/oidc/config'),
    api.get('/auth/me/jira'),
  ]);

  oidcEnabled.value = !!oidcResponse.data.enabled;
  jiraBaseUrl.value = jiraResponse.data.jiraBaseUrl || '';
  jiraEmail.value = jiraResponse.data.jiraEmail || '';
  hasStoredJiraToken.value = !!jiraResponse.data.hasJiraToken;
};

const openProfile = async () => {
  closeMenu();
  isProfileOpen.value = true;
  try {
    await hydrateProfileForm();
  } catch {
    errorText.value = 'Impossible de charger le profil Jira.';
  }
};

const cancelProfile = async () => {
  isProfileOpen.value = false;
  errorText.value = '';
  successText.value = '';
  await router.replace({ query: { ...route.query, openProfile: undefined } });
};

const logout = async () => {
  closeMenu();
  await authStore.logout();
  await router.push('/login');
};

const goAdmin = async () => {
  closeMenu();
  await router.push('/admin');
};

const pickAvatarFile = () => {
  avatarInput.value?.click();
};

const toDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('FILE_READ_ERROR'));
    reader.readAsDataURL(file);
  });

const updateAvatar = async (avatarDataUrl: string | null) => {
  const { data } = await api.patch('/auth/me/avatar', { avatarDataUrl });
  authStore.setUser(data.user);
};

const onAvatarPicked = async (event: Event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) {
    return;
  }

  errorText.value = '';
  successText.value = '';
  isAvatarSaving.value = true;
  try {
    const dataUrl = await toDataUrl(file);
    await updateAvatar(dataUrl);
    successText.value = 'Avatar enregistré.';
  } catch {
    errorText.value = "Impossible d'enregistrer l'avatar.";
  } finally {
    isAvatarSaving.value = false;
  }
};

const removeAvatar = async () => {
  errorText.value = '';
  successText.value = '';
  isAvatarSaving.value = true;
  try {
    await updateAvatar(null);
    successText.value = 'Avatar supprimé.';
  } catch {
    errorText.value = "Impossible de supprimer l'avatar.";
  } finally {
    isAvatarSaving.value = false;
  }
};

const testJiraCredentials = async () => {
  errorText.value = '';
  successText.value = '';
  isTestingJira.value = true;

  try {
    await api.post('/auth/me/jira/test', {
      jiraBaseUrl: jiraBaseUrl.value.trim(),
      jiraEmail: jiraEmail.value.trim(),
      jiraToken: jiraToken.value,
    });
    successText.value = 'Connexion Jira valide.';
  } catch {
    errorText.value = 'Impossible de se connecter à Jira avec ces informations.';
  } finally {
    isTestingJira.value = false;
  }
};

const saveProfile = async () => {
  errorText.value = '';
  successText.value = '';
  isProfileSaving.value = true;

  try {
    const { data } = await api.patch('/auth/me', {
      displayName: profileDisplayName.value.trim(),
      jiraBaseUrl: jiraBaseUrl.value.trim(),
      jiraEmail: jiraEmail.value.trim(),
      jiraToken: jiraToken.value,
    });

    authStore.setUser(data.user);
    hasStoredJiraToken.value = true;
    jiraToken.value = '';
    await cancelProfile();
  } catch {
    errorText.value = 'Impossible de sauvegarder le profil.';
  } finally {
    isProfileSaving.value = false;
  }
};

const handleWindowClick = (event: MouseEvent) => {
  const target = event.target as HTMLElement | null;
  if (!target?.closest('.avatarMenuWrap')) {
    closeMenu();
  }
};

watch(
  () => route.query.openProfile,
  async (value) => {
    if (value === '1' && !isProfileOpen.value) {
      await openProfile();
    }
  },
  { immediate: true },
);

onMounted(() => {
  window.addEventListener('click', handleWindowClick);
});

onUnmounted(() => {
  window.removeEventListener('click', handleWindowClick);
});
</script>

<style scoped>
.appHeader {
  position: sticky;
  top: 0;
  z-index: 40;
  height: 62px;
  padding: 8px 16px;
  border-bottom: 1px solid #d7e3ef;
  background: rgba(255, 255, 255, 0.9);
  backdrop-filter: blur(6px);
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
}

.headerSide {
  min-width: 40px;
}

.headerSide.right {
  display: flex;
  justify-content: flex-end;
}

.appTitle {
  margin: 0;
  text-align: center;
  font-size: 22px;
  color: #17324f;
}

.avatarMenuWrap {
  position: relative;
}

.avatarButton {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  padding: 0;
  border: 1px solid #a9bfd7;
  background: #eef5fd;
  color: #204767;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.avatarButton img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.userMenu {
  position: absolute;
  right: 0;
  top: calc(100% + 8px);
  min-width: 170px;
  background: #ffffff;
  border: 1px solid #d5e2ef;
  border-radius: 10px;
  box-shadow: 0 10px 24px rgba(18, 37, 58, 0.16);
  padding: 6px;
  display: grid;
  gap: 4px;
}

.userMenuItem {
  text-align: left;
  background: #ffffff;
  color: #1a3652;
}

.userMenuItem:hover {
  background: #f3f8ff;
}

.userMenuItem.danger {
  color: #7d1f1f;
}

.dialogOverlay {
  position: fixed;
  inset: 0;
  background: rgba(17, 33, 52, 0.44);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 60;
  padding: 18px;
}

.dialogCard {
  width: min(820px, 100%);
  background: #ffffff;
  border: 1px solid #cfe0f0;
  border-radius: 12px;
  padding: 18px;
  display: grid;
  gap: 16px;
}

.dialogHeader h2 {
  margin: 0;
  font-size: 20px;
}

.profileGrid {
  display: grid;
  grid-template-columns: 240px 1fr;
  gap: 28px;
  align-items: start;
}

.avatarColumn {
  display: grid;
  gap: 14px;
  justify-items: center;
}

.profileAvatar {
  width: 124px;
  height: 124px;
  border-radius: 50%;
  border: 1px solid #bed0e3;
  background: #ebf3fd;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #204767;
  font-weight: 700;
  font-size: 28px;
  overflow: hidden;
}

.profileAvatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.avatarActions {
  width: 100%;
  display: grid;
  gap: 10px;
}

.profileForm {
  display: grid;
  gap: 12px;
}

.profileForm label {
  font-size: 13px;
  font-weight: 600;
  color: #38546f;
}

.profileForm input[readonly] {
  background: #f5f9fd;
  color: #3f5870;
}

.dialogFooter {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.inlineSpinner {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.55);
  border-top-color: #ffffff;
  display: inline-block;
  margin-right: 6px;
  vertical-align: -2px;
  animation: spin 0.8s linear infinite;
}

.hiddenInput {
  display: none;
}

.errorText {
  margin: 0;
  color: #9f2525;
}

.successText {
  margin: 0;
  color: #216c3f;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 760px) {
  .appHeader {
    padding: 8px 10px;
  }

  .appTitle {
    font-size: 18px;
  }

  .profileGrid {
    grid-template-columns: 1fr;
    gap: 18px;
  }

  .avatarColumn {
    justify-items: stretch;
  }

  .profileAvatar {
    justify-self: center;
  }
}
</style>

