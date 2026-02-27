<template>
  <main class="layout" style="display: grid; gap: 20px">
    <header style="display: flex; align-items: center">
      <h1>Planning Poker</h1>
    </header>

    <section class="card">
      <h2>Créer une session</h2>
      <div v-if="!authStore.user?.hasJiraCredentials" class="jiraWarning">
        <span>Vous devez saisir vos informations Jira pour pouvoir créer une session.</span>
        <button type="button" class="linkButton" @click="openProfileDialog">Ouvrir Mon Profil</button>
      </div>
      <form v-if="authStore.user?.hasJiraCredentials" style="display: grid; gap: 12px" @submit.prevent="createSession">
        <input v-model="sessionName" placeholder="Nom de session" required />

        <div style="display: grid; gap: 8px">
          <label>Projet Jira (autocomplete)</label>
          <div style="position: relative">
            <input v-model="projectSearch" placeholder="Rechercher un projet (ex: CORE)" @input="handleProjectSearch"
              @focus="isProjectSuggestionOpen = true" @blur="closeProjectSuggestions" />
            <div v-if="isProjectSuggestionOpen && filteredProjects.length > 0" style="
                position: absolute;
                z-index: 10;
                top: calc(100% + 4px);
                left: 0;
                right: 0;
                background: #fff;
                border: 1px solid #c9d5e3;
                border-radius: 8px;
                max-height: 180px;
                overflow: auto;
              ">
              <button v-for="project in filteredProjects" :key="project.key" type="button" class="secondary"
                style="width: 100%; text-align: left; border-radius: 0; border: 0; border-bottom: 1px solid #eef3f9"
                @mousedown.prevent="selectProject(project)">
                {{ project.key }} - {{ project.name }}
              </button>
            </div>
          </div>
          <div style="display: flex; gap: 8px">
            <button type="button" class="secondary" @click="loadProjects">Rafraîchir projets</button>
            <button type="button" class="secondary" :disabled="!selectedProjectKey" @click="refreshSelectableIssues">
              Rafraîchir tickets
            </button>
          </div>
        </div>

        <div v-if="selectedProjectKey" style="display: grid; gap: 8px">
          <label>Statut</label>
          <select :value="selectedStatusName" @change="handleStatusSelect">
            <option value="">Sélectionner un statut</option>
            <option v-for="status in availableStatuses" :key="status" :value="status">
              {{ status }}
            </option>
          </select>
        </div>

        <div v-if="selectedProjectKey && selectedStatusName" style="display: grid; gap: 8px">
          <label>Tickets disponibles ({{ filteredIssuesByStatus.length }})</label>
          <div style="
              border: 1px solid #d5e1ee;
              border-radius: 8px;
              max-height: 240px;
              overflow: auto;
              padding: 8px;
              display: grid;
              gap: 6px;
            ">
            <div v-if="isIssuesLoading" style="display: flex; align-items: center; gap: 8px; color: #35516e">
              <span style="
                  width: 14px;
                  height: 14px;
                  border: 2px solid #a9c3de;
                  border-top-color: #1576d6;
                  border-radius: 50%;
                  display: inline-block;
                  animation: spin 0.8s linear infinite;
                " />
              <span>Chargement en cours...</span>
            </div>
            <label v-for="issue in filteredIssuesByStatus" :key="issue.key" class="selectedTicketItem">
              <div class="projectTicketMain">
                <input v-model="selectedIssueKeys" type="checkbox" :value="issue.key" style="width: auto" />
                <a :href="issue.browseUrl || '#'" target="_blank" rel="noopener noreferrer" class="selectedTicketKey">
                  {{ issue.key }}
                </a>
                <span class="selectedTicketSummary">{{ issue.summary }}</span>
              </div>
            </label>
            <div v-if="!isIssuesLoading && filteredIssuesByStatus.length === 0">
              Aucun ticket avec ce statut.
            </div>
          </div>
          <button type="button" :disabled="selectedIssueKeys.length === 0 || isIssuesLoading"
            @click="addSelectedIssuesInBulk">
            Ajouter les tickets sélectionnés
          </button>
        </div>

        <div style="display: grid; grid-template-columns: 1fr auto; gap: 8px">
          <input v-model="directIssueKey" placeholder="Ou ajouter par code (ex: PROJ-123)"
            @keydown.enter.prevent="addIssueByKey" />
          <button type="button" class="secondary" :disabled="isDirectIssueLoading" @click="addIssueByKey">
            <span v-if="isDirectIssueLoading" class="inlineSpinner" />
            {{ isDirectIssueLoading ? 'Veuillez patienter...' : 'Ajouter par code' }}
          </button>
        </div>

        <div>
          <strong>Tickets sélectionnés</strong>
          <div class="selectedTicketsList">
            <div v-if="tickets.length === 0" class="selectedTicketEmpty">
              Aucun ticket ajouté pour le moment.
            </div>
            <div v-for="ticket in tickets" :key="ticket.jiraIssueKey" class="selectedTicketItem">
              <div class="selectedTicketMain">
                <a :href="ticket.browseUrl || '#'" target="_blank" rel="noopener noreferrer" class="selectedTicketKey">
                  {{ ticket.jiraIssueKey }}
                </a>
                <span class="selectedTicketSummary">{{ ticket.summary }}</span>
              </div>
              <button type="button" class="selectedTicketRemove" title="Retirer ce ticket"
                @click="removeSelectedTicket(ticket.jiraIssueKey)">
                ✕
              </button>
            </div>
          </div>
        </div>

        <p v-if="creationError" class="creationError">{{ creationError }}</p>
        <button type="submit" :disabled="tickets.length === 0 || !authStore.user?.hasJiraCredentials">
          Créer la session
        </button>
      </form>
    </section>

    <section class="card">
      <h2>Rejoindre une session</h2>
      <form style="display: grid; grid-template-columns: 1fr auto; gap: 8px" @submit.prevent="joinByCode">
        <input v-model="joinCode" placeholder="Code session (6 caractères)" />
        <button type="submit">Rejoindre</button>
      </form>
    </section>
  </main>
</template>

<script setup lang="ts">
/* istanbul ignore file */
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../services/api';
import { useAuthStore } from '../stores/auth';

type Project = { id: string; key: string; name: string };
type Issue = {
  id: string;
  key: string;
  summary: string;
  statusId: string;
  statusName: string;
  browseUrl?: string;
};

const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();

const buildDefaultSessionName = () => {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const yyyy = now.getFullYear();
  const hh = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');

  return `Planning poker du ${dd}/${mm}/${yyyy} ${hh}:${min}`;
};

const sessionName = ref(buildDefaultSessionName());
const joinCode = ref('');
const selectedProjectKey = ref('');
const selectedStatusName = ref('');
const directIssueKey = ref('');
const selectedIssueKeys = ref<string[]>([]);
const projectSearch = ref('');
const isProjectSuggestionOpen = ref(false);
const projects = ref<Project[]>([]);
const issues = ref<Issue[]>([]);
const tickets = ref<Array<{ jiraIssueKey: string; jiraIssueId: string; summary: string; browseUrl?: string }>>([]);
const issuesRequestId = ref(0);
const isIssuesLoading = ref(false);
const isDirectIssueLoading = ref(false);
const creationError = ref('');

const filteredProjects = computed(() => {
  const term = projectSearch.value.trim().toLowerCase();

  if (!term) {
    return projects.value.slice(0, 10);
  }

  return projects.value
    .filter(
      (project) =>
        project.key.toLowerCase().includes(term) || project.name.toLowerCase().includes(term),
    )
    .slice(0, 10);
});

const availableStatuses = ref<string[]>([]);

const filteredIssuesByStatus = computed(() => {
  const selectedKeys = new Set(tickets.value.map((ticket) => ticket.jiraIssueKey));
  return issues.value.filter((issue) => !selectedKeys.has(issue.key));
});
const loadProjects = async () => {
  try {
    const { data } = await api.get('/jira/projects');
    projects.value = data.items;
  } catch {
    projects.value = [];
  }
};

const loadProjectIssuesForStatus = async (statusName: string) => {
  if (!selectedProjectKey.value || !statusName) {
    isIssuesLoading.value = false;
    issues.value = [];
    selectedIssueKeys.value = [];
    return;
  }

  const requestId = issuesRequestId.value + 1;
  issuesRequestId.value = requestId;
  const currentProjectKey = selectedProjectKey.value;
  isIssuesLoading.value = true;
  issues.value = [];
  selectedIssueKeys.value = [];

  try {
    const { data } = await api.get(`/jira/projects/${selectedProjectKey.value}/issues`, {
      params: {
        status: statusName,
      },
    });

    // Ignore stale responses if user changed status/project before request completed.
    if (
      requestId !== issuesRequestId.value ||
      currentProjectKey !== selectedProjectKey.value ||
      statusName !== selectedStatusName.value
    ) {
      return;
    }

    issues.value = data.items;
  } finally {
    if (requestId === issuesRequestId.value) {
      isIssuesLoading.value = false;
    }
  }
};

const refreshSelectableIssues = async () => {
  if (!selectedProjectKey.value) {
    isIssuesLoading.value = false;
    availableStatuses.value = [];
    issues.value = [];
    selectedStatusName.value = '';
    selectedIssueKeys.value = [];
    return;
  }

  const statusesResponse = await api.get(`/jira/projects/${selectedProjectKey.value}/statuses`);
  availableStatuses.value = statusesResponse.data.items;

  if (!availableStatuses.value.includes(selectedStatusName.value)) {
    isIssuesLoading.value = false;
    selectedStatusName.value = '';
    issues.value = [];
    selectedIssueKeys.value = [];
    return;
  }

  await loadProjectIssuesForStatus(selectedStatusName.value);
};

const handleStatusSelect = async (event: Event) => {
  const nextStatus = (event.target as HTMLSelectElement).value || '';
  selectedStatusName.value = nextStatus;

  if (!nextStatus) {
    issuesRequestId.value += 1;
    isIssuesLoading.value = false;
    issues.value = [];
    selectedIssueKeys.value = [];
    return;
  }

  await loadProjectIssuesForStatus(nextStatus);
};

const addSelectedIssuesInBulk = () => {
  const issuesToAdd = filteredIssuesByStatus.value.filter((issue) =>
    selectedIssueKeys.value.includes(issue.key),
  );

  issuesToAdd.forEach((issue) => {
    if (!tickets.value.find((item) => item.jiraIssueKey === issue.key)) {
      tickets.value.push({
        jiraIssueKey: issue.key,
        jiraIssueId: issue.id,
        summary: issue.summary,
        browseUrl: issue.browseUrl,
      });
    }
  });

  selectedIssueKeys.value = [];
};

const removeSelectedTicket = (jiraIssueKey: string) => {
  tickets.value = tickets.value.filter((ticket) => ticket.jiraIssueKey !== jiraIssueKey);
};

const addIssueByKey = async () => {
  if (!directIssueKey.value.trim() || isDirectIssueLoading.value) return;

  isDirectIssueLoading.value = true;
  try {
    const { data } = await api.get(`/jira/issues/${directIssueKey.value.trim().toUpperCase()}`);
    if (!tickets.value.find((item) => item.jiraIssueKey === data.item.key)) {
      tickets.value.push({
        jiraIssueKey: data.item.key,
        jiraIssueId: data.item.id,
        summary: data.item.summary,
        browseUrl: data.item.browseUrl,
      });
    }

    directIssueKey.value = '';
  } finally {
    isDirectIssueLoading.value = false;
  }
};

const createSession = async () => {
  creationError.value = '';
  if (!authStore.user?.hasJiraCredentials) {
    creationError.value = 'Vous devez configurer vos informations Jira avant de créer une session.';
    return;
  }

  try {
    const { data } = await api.post('/sessions', {
      name: sessionName.value,
      tickets: tickets.value,
    });

    await router.push(`/session/${data.session.code}`);
  } catch {
    creationError.value = 'Impossible de créer la session. Vérifiez votre configuration Jira.';
  }
};

const openProfileDialog = async () => {
  await router.push({ path: '/', query: { ...route.query, openProfile: '1' } });
};

const handleProjectSearch = () => {
  isProjectSuggestionOpen.value = true;
};

const selectProject = async (project: Project) => {
  projectSearch.value = `${project.key} - ${project.name}`;
  selectedProjectKey.value = project.key;
  isProjectSuggestionOpen.value = false;
  selectedStatusName.value = '';
  issues.value = [];
  selectedIssueKeys.value = [];
  await refreshSelectableIssues();
};

const closeProjectSuggestions = () => {
  setTimeout(() => {
    isProjectSuggestionOpen.value = false;
  }, 120);
};

const joinByCode = async () => {
  const { data } = await api.get(`/sessions/join/${joinCode.value}`);
  await router.push(`/session/${data.session.code}`);
};

onMounted(async () => {
  if (authStore.user?.hasJiraCredentials) {
    await loadProjects();
  }

  const joinCodeFromPath = route.params.code as string | undefined;
  if (joinCodeFromPath) {
    joinCode.value = joinCodeFromPath;
    await joinByCode();
  }
});
</script>

<style scoped>
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
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

.selectedTicketsList {
  margin-top: 8px;
  border: 1px solid #d5e1ee;
  border-radius: 10px;
  background: #f8fbff;
  display: grid;
  gap: 8px;
  padding: 10px;
}

.jiraWarning {
  margin-bottom: 12px;
  padding: 10px 12px;
  border: 1px solid #efd17e;
  border-radius: 8px;
  background: #fff7dc;
  color: #6a4a1b;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.linkButton {
  border: 0;
  background: transparent;
  color: #0f4c8a;
  padding: 0;
  text-decoration: underline;
}

.creationError {
  margin: 0;
  color: #a32121;
}

.selectedTicketEmpty {
  color: #617b95;
  font-size: 14px;
}

.selectedTicketItem {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: 10px;
  border: 1px solid #dce8f5;
  border-radius: 8px;
  background: #ffffff;
  padding: 8px 10px;
}

.selectedTicketMain {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 10px;
  align-items: center;
  min-width: 0;
}

.projectTicketMain {
  display: grid;
  grid-template-columns: auto auto 1fr;
  gap: 10px;
  align-items: center;
  min-width: 0;
}

.selectedTicketKey {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 700;
  color: #0f4c8a;
  background: #e6f1fd;
  border: 1px solid #c7def8;
  border-radius: 20px;
  padding: 2px 8px;
  white-space: nowrap;
  text-decoration: none;
}

.selectedTicketSummary {
  color: #1f3347;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.selectedTicketRemove {
  width: 28px;
  height: 28px;
  border-radius: 999px;
  border: 1px solid #f0c2c2;
  background: #fff1f1;
  color: #a72a2a;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 700;
  padding: 0;
}

.selectedTicketRemove:hover {
  background: #ffdede;
}
</style>
