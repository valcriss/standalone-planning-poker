<template>
  <main class="layout pokerLayout" v-if="sessionStore.session">
    <header class="pokerHeader">
      <div class="headerLeft">
        <h1>{{ sessionStore.session.name }}</h1>
        <p class="sessionMeta">Code {{ sessionStore.session.code }}</p>
      </div>
      <div class="headerActions">
        <button class="secondary" @click="copyJoinLink">Copier le lien</button>
        <button class="secondary" @click="goHome">Retour</button>
        <button v-if="isHost && !isClosing" @click="closeSession">Clôturer</button>
      </div>
    </header>

    <p v-if="actionError" class="errorText">{{ actionError }}</p>
    <div v-if="isClosing" class="closingBanner">
      Session en cours de fermeture dans {{ closingCountdown }} seconde(s)
    </div>

    <section class="pokerGrid">
      <aside class="card sideCol">
        <div class="boxTitle">Vous</div>
        <div class="currentUserCard">
          <div class="avatar">
            <img
              v-if="authStore.user?.avatarDataUrl"
              :src="authStore.user.avatarDataUrl"
              alt="Avatar utilisateur"
              class="avatarImage"
            />
            <template v-else>{{ initials(authStore.user?.displayName || '?') }}</template>
          </div>
          <div>
            <div class="name">{{ authStore.user?.displayName }}</div>
            <div class="role">{{ currentParticipant?.isObserver ? 'Observateur' : 'Votant' }}</div>
          </div>
        </div>
        <button class="secondary" @click="toggleObserver">
          {{ currentParticipant?.isObserver ? 'Passer votant' : 'Passer observateur' }}
        </button>

        <div class="boxTitle participantsTitle">Participants</div>
        <div class="participantsList">
          <div v-for="participant in sessionStore.session.participants" :key="participant.userId"
            class="participantRow">
            <div class="participantMain">
              <span class="avatar">
                <img
                  v-if="participant.user.avatarDataUrl"
                  :src="participant.user.avatarDataUrl"
                  alt="Avatar participant"
                  class="avatarImage"
                />
                <template v-else>{{ initials(participant.user.displayName) }}</template>
              </span>
              <div>
                <div class="name">
                  {{ participant.user.displayName }}
                  <span v-if="participant.userId === sessionStore.session.hostUserId" class="hostBadge">Hôte</span>
                </div>
                <div class="role">{{ participant.isObserver ? 'Observateur' : 'Votant' }}</div>
              </div>
            </div>
            <button v-if="isHost && participant.userId !== sessionStore.session.hostUserId" class="secondary tiny"
              @click="transferHost(participant.userId)">
              Transférer
            </button>
          </div>
        </div>
      </aside>

      <section class="card centerCol">
        <div class="boxTitle">Story active</div>
        <div class="activeStory">
          <template v-if="sessionStore.session.activeTicket">
            <a :href="activeTicketBrowseUrl" target="_blank" rel="noopener noreferrer" class="activeTicketKey">
              {{ sessionStore.session.activeTicket.jiraIssueKey }}
            </a>
            <div class="activeTicketTitle">{{ activeTicketTitle }}</div>
            <div class="activeTicketDescriptionExcerpt">
              {{ activeTicketDescriptionExcerpt }}
              <button v-if="hasLongDescription" type="button" class="readMoreLink"
                @click="isDescriptionDialogOpen = true">
                Lire la suite
              </button>
            </div>
          </template>
          <template v-else>
            <div class="emptyText">Aucune story active</div>
          </template>
        </div>

        <div class="votersBoard">
          <div v-for="participant in activeParticipants" :key="participant.userId" class="voterItem">
            <div
              :class="['voteCard', !hasActiveStory ? 'isFaceDown isDisabled' : '']"
              :aria-disabled="!hasActiveStory"
            >
              <template v-if="!hasActiveStory">
                &nbsp;
              </template>
              <template v-else-if="sessionStore.session.phase === 'REVEALED'">
                <template v-if="sessionStore.session.revealedVotes?.[participant.userId] === 'coffee'">
                  <img src="/images/coffee.png" alt="Café" class="coffeeImage" />
                </template>
                <template v-else>
                  {{ sessionStore.session.revealedVotes?.[participant.userId] || '?' }}
                </template>
              </template>
              <template v-else>
                {{ sessionStore.session.votedUserIds.includes(participant.userId) ? '*' : '' }}
              </template>
            </div>
            <div class="avatarActionWrap" :data-user-id="participant.userId">
              <button v-if="participant.userId === authStore.user?.id" type="button"
                :class="['avatarBubbleButton', reactionCooldownLeft > 0 ? 'cooldown' : '']"
                aria-label="Avatar action menu" :disabled="reactionCooldownLeft > 0" @click="toggleEmojiPanel">
                <span v-if="reactionCooldownLeft > 0" class="avatarCooldownText">
                  {{ reactionCooldownLeft }}s
                </span>
                <span v-else class="avatarBubbleDots">
                  <span class="dot" />
                  <span class="dot" />
                  <span class="dot" />
                </span>
              </button>
              <div v-if="participant.userId === authStore.user?.id && isEmojiPanelOpen" class="emojiPanel">
                <button v-for="emoji in reactionEmojis" :key="emoji" type="button" class="emojiButton"
                  :disabled="isReactionCoolingDown" @click="sendReaction(emoji)">
                  {{ emoji }}
                </button>
              </div>
              <div class="avatar small">
                <img
                  v-if="participant.user.avatarDataUrl"
                  :src="participant.user.avatarDataUrl"
                  alt="Avatar votant"
                  class="avatarImage"
                />
                <template v-else>{{ initials(participant.user.displayName) }}</template>
              </div>
            </div>
            <div class="voterName">{{ participant.user.displayName }}</div>
          </div>
        </div>

        <div v-if="sessionStore.session.phase === 'REVEALED'" class="resultsBox">
          <div class="resultBars">
            <div v-for="value in sessionStore.session.allowedVotes" :key="value" class="resultRow">
              <div class="resultLabel">{{ value }}</div>
              <div class="resultTrack">
                <div class="resultFill" :style="{ width: barWidth(value) }" />
              </div>
              <div class="resultCount">{{ sessionStore.session.voteStats?.countsByValue?.[value] || 0 }}</div>
            </div>
          </div>
          <div class="summaryLine">
            <span>Min: {{ sessionStore.session.voteStats?.minimum ?? '-' }}</span>
            <span>Max: {{ sessionStore.session.voteStats?.maximum ?? '-' }}</span>
            <span>Moyenne: {{ averageDisplay }}</span>
          </div>

          <div v-if="isHost && !isClosing" class="hostActions">
            <input v-model.number="storyPoints" type="number" min="1" step="1" />
            <button :disabled="isAssigning" @click="assign">
              <span v-if="isAssigning" class="inlineSpinner" />
              {{ isAssigning ? 'Mise à jour en cours...' : 'Attribuer' }}
            </button>
            <button class="secondary" @click="restart">Relancer</button>
            <button class="secondary" @click="skip">Passer</button>
          </div>
        </div>
        <div v-else class="voteValues">
          <button
            v-for="value in sessionStore.session.allowedVotes"
            :key="value"
            :disabled="!canVote"
            :class="['voteButton', !hasActiveStory ? 'isFaceDown' : '', hasActiveStory && String(myVote) === String(value) ? 'active' : '']"
            @click="vote(value)"
          >
            <template v-if="!hasActiveStory">
              &nbsp;
            </template>
            <template v-else-if="value === 'coffee'">
              <img src="/images/coffee.png" alt="Café" class="coffeeImage" />
            </template>
            <template v-else>
              {{ value }}
            </template>
          </button>
        </div>

        <div v-if="isHost && sessionStore.session.phase === 'VOTING'" class="hostPrimary">
          <button @click="reveal">Terminer le vote</button>
        </div>
      </section>

      <aside class="card sideCol">
        <div class="boxTitle">Stories à estimer</div>
        <div class="storiesList">
          <div v-for="ticket in remainingTickets" :key="ticket.id"
            :class="['storyRow', ticket.id === sessionStore.session.activeTicketId ? 'active' : '']">
            <div>
              <a :href="ticket.browseUrl || '#'" target="_blank" rel="noopener noreferrer" class="storyKey">
                {{ ticket.jiraIssueKey }}
              </a>
              <div class="storySummary">{{ ticket.summary }}</div>
            </div>
            <button v-if="isHost && !isClosing" class="secondary tiny"
              :disabled="ticket.id === sessionStore.session.activeTicketId" @click="activate(ticket.id)">
              {{ ticket.id === sessionStore.session.activeTicketId ? 'Actif' : 'Activer' }}
            </button>
          </div>
        </div>
      </aside>
    </section>

    <div v-if="isDescriptionDialogOpen" class="dialogOverlay" @click.self="isDescriptionDialogOpen = false">
      <div class="dialogCard">
        <div class="dialogHeader">
          <h3>Description complète</h3>
          <button type="button" class="secondary tiny" @click="isDescriptionDialogOpen = false">
            Fermer
          </button>
        </div>
        <div class="dialogBody">
          <div v-if="activeTicketDescriptionHtml" v-html="activeTicketDescriptionHtml" />
          <template v-else>{{ activeTicketDescription || 'Aucune description.' }}</template>
        </div>
      </div>
    </div>

    <canvas v-show="isFireworksVisible" ref="fireworksCanvas" class="fireworksCanvas" />
    <canvas v-show="isEmojiFxVisible" ref="emojiFxCanvas" class="fireworksCanvas" />
    <audio ref="fireworksAudio" preload="auto">
      <source src="/sounds/clap.ogg" type="audio/ogg" />
      <source src="/sounds/clap.mp3" type="audio/mpeg" />
    </audio>
  </main>
</template>

<script setup lang="ts">
/* istanbul ignore file */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useSessionStore } from '../stores/session';
import { useAuthStore } from '../stores/auth';
import { api } from '../services/api';
import { socket } from '../services/socket';

const route = useRoute();
const router = useRouter();
const sessionStore = useSessionStore();
const authStore = useAuthStore();

const sessionIdFromRoute = route.params.id as string | undefined;
const sessionCodeFromRoute = route.params.code as string | undefined;
const resolvedSessionId = ref('');
const storyPoints = ref(3);
const myVote = ref<string | null>(null);
const actionError = ref('');
const closingCountdown = ref(60);
const isAssigning = ref(false);
const activeTicketDescription = ref('');
const activeTicketDescriptionHtml = ref('');
const activeTicketBrowseUrl = ref('#');
const activeTicketTitle = ref('');
const isDescriptionDialogOpen = ref(false);
const isFireworksVisible = ref(false);
const fireworksCanvas = ref<HTMLCanvasElement | null>(null);
const fireworksAudio = ref<HTMLAudioElement | null>(null);
const isEmojiPanelOpen = ref(false);
const isReactionCoolingDown = ref(false);
const reactionCooldownLeft = ref(0);
const isEmojiFxVisible = ref(false);
const emojiFxCanvas = ref<HTMLCanvasElement | null>(null);
const reactionEmojis = ['🎉', '😂', '👍', '❤️', '👏', '😮', '😢', '🔥', '🚀', '🥳', '💡', '✅', '🤯', '👀', '🙌'];
let closingInterval: ReturnType<typeof setInterval> | null = null;
let fireworksRafId: number | null = null;
let fireworksTimeout: ReturnType<typeof setTimeout> | null = null;
let emojiFxRafId: number | null = null;
let emojiFxTimeout: ReturnType<typeof setTimeout> | null = null;
let reactionCooldownInterval: ReturnType<typeof setInterval> | null = null;
let sessionPingInterval: ReturnType<typeof setInterval> | null = null;
const hasAutoRedirected = ref(false);

const isHost = computed(
  () => sessionStore.session?.hostUserId === authStore.user?.id || authStore.user?.role === 'ADMIN',
);
const isClosing = computed(() => sessionStore.session?.phase === 'CLOSING');
const joinUrl = computed(() =>
  sessionStore.session ? `${window.location.origin}/session/${sessionStore.session.code}` : '',
);
const currentParticipant = computed(() =>
  sessionStore.session?.participants.find((participant) => participant.userId === authStore.user?.id),
);
const activeParticipants = computed(
  () => sessionStore.session?.participants.filter((participant) => !participant.isObserver) || [],
);
const remainingTickets = computed(
  () => sessionStore.session?.tickets.filter((ticket) => !ticket.isDone) || [],
);
const canVote = computed(
  () =>
    !!sessionStore.session &&
    sessionStore.session.phase === 'VOTING' &&
    !!sessionStore.session.activeTicket &&
    !currentParticipant.value?.isObserver &&
    !isClosing.value,
);
const hasActiveStory = computed(() => !!sessionStore.session?.activeTicket);
const averageDisplay = computed(() => {
  const average = sessionStore.session?.voteStats?.average;
  return average === null || average === undefined ? '-' : Number(average.toFixed(2));
});
const activeTicketDescriptionExcerpt = computed(() => {
  const value = activeTicketDescription.value.trim();
  if (!value) {
    return 'Aucune description.';
  }

  if (value.length <= 50) {
    return value;
  }

  return `${value.slice(0, 50)}...`;
});
const hasLongDescription = computed(() => activeTicketDescription.value.trim().length > 50);
const maxBarCount = computed(() => {
  const counts = sessionStore.session?.voteStats?.countsByValue || {};
  const values = Object.values(counts);
  return values.length ? Math.max(...values, 1) : 1;
});

const barWidth = (value: string) => {
  const count = sessionStore.session?.voteStats?.countsByValue?.[value] || 0;
  return `${Math.round((count / maxBarCount.value) * 100)}%`;
};

const initials = (name: string) =>
  name
    .split(' ')
    .map((part) => part[0] || '')
    .join('')
    .slice(0, 2)
    .toUpperCase();

const request = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
    actionError.value = '';
  } catch {
    actionError.value = 'Action impossible pour le moment.';
  }
};

const getSessionId = () => resolvedSessionId.value || sessionStore.session?.id || '';

const requireSessionId = () => {
  const id = getSessionId();
  if (!id) {
    throw new Error('SESSION_NOT_READY');
  }

  return id;
};

const activate = async (ticketId: string) => {
  await request(() => api.post(`/sessions/${requireSessionId()}/activate-ticket`, { ticketId }));
};

const vote = async (value: string) => {
  myVote.value = value;
  await request(() => sessionStore.vote(value));
};

const reveal = async () => {
  await request(() => api.post(`/sessions/${requireSessionId()}/reveal`));
};

const restart = async () => {
  myVote.value = null;
  await request(() => api.post(`/sessions/${requireSessionId()}/restart-vote`));
};

const skip = async () => {
  myVote.value = null;
  await request(() => api.post(`/sessions/${requireSessionId()}/skip-ticket`));
};

const assign = async () => {
  if (isAssigning.value) {
    return;
  }

  isAssigning.value = true;
  try {
    await request(() =>
      api.post(`/sessions/${requireSessionId()}/assign-story-points`, {
        storyPoints: Number(storyPoints.value),
      }),
    );
  } finally {
    isAssigning.value = false;
  }
};

const closeSession = async () => {
  await request(() => api.post(`/sessions/${requireSessionId()}/close`));
};

const transferHost = async (userId: string) => {
  await request(() => api.post(`/sessions/${requireSessionId()}/transfer-host`, { userId }));
};

const toggleObserver = async () => {
  const next = !currentParticipant.value?.isObserver;
  await request(() => api.post(`/sessions/${requireSessionId()}/observer`, { isObserver: next }));
};

const copyJoinLink = async () => {
  await navigator.clipboard.writeText(joinUrl.value);
};

const goHome = async () => {
  await router.push('/');
};

const refreshClosingCountdown = () => {
  const closingEndsAt = sessionStore.session?.closingEndsAt;
  if (!closingEndsAt) {
    closingCountdown.value = 60;
    return;
  }

  const remainingMs = new Date(closingEndsAt).getTime() - Date.now();
  closingCountdown.value = Math.max(0, Math.ceil(remainingMs / 1000));
};

const loadActiveTicketDetails = async () => {
  const activeKey = sessionStore.session?.activeTicket?.jiraIssueKey;

  if (!activeKey) {
    activeTicketTitle.value = '';
    activeTicketDescription.value = '';
    activeTicketDescriptionHtml.value = '';
    activeTicketBrowseUrl.value = '#';
    isDescriptionDialogOpen.value = false;
    return;
  }

  const escapeHtml = (value: string) =>
    value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');

  const renderMarks = (text: string, marks?: Array<{ type?: string; attrs?: Record<string, unknown> }>) => {
    let html = escapeHtml(text);
    (marks || []).forEach((mark) => {
      if (mark.type === 'strong') {
        html = `<strong>${html}</strong>`;
      } else if (mark.type === 'em') {
        html = `<em>${html}</em>`;
      } else if (mark.type === 'code') {
        html = `<code>${html}</code>`;
      } else if (mark.type === 'underline') {
        html = `<u>${html}</u>`;
      } else if (mark.type === 'strike') {
        html = `<s>${html}</s>`;
      } else if (mark.type === 'subsup') {
        const kind = mark.attrs?.type === 'sub' ? 'sub' : 'sup';
        html = `<${kind}>${html}</${kind}>`;
      } else if (mark.type === 'textColor') {
        const color =
          typeof mark.attrs?.color === 'string' && mark.attrs.color.trim()
            ? escapeHtml(mark.attrs.color)
            : '#1f3347';
        html = `<span style="color:${color}">${html}</span>`;
      } else if (mark.type === 'backgroundColor') {
        const color =
          typeof mark.attrs?.color === 'string' && mark.attrs.color.trim()
            ? escapeHtml(mark.attrs.color)
            : '#fff59d';
        html = `<span style="background-color:${color};padding:0 2px;border-radius:3px">${html}</span>`;
      } else if (mark.type === 'link') {
        const href = typeof mark.attrs?.href === 'string' ? escapeHtml(mark.attrs.href) : '#';
        html = `<a href="${href}" target="_blank" rel="noopener noreferrer">${html}</a>`;
      }
    });
    return html;
  };

  const renderAdfNode = (node: unknown): string => {
    if (!node || typeof node !== 'object') {
      return '';
    }

    const current = node as {
      type?: string;
      text?: string;
      marks?: Array<{ type?: string; attrs?: Record<string, unknown> }>;
      attrs?: Record<string, unknown>;
      content?: unknown[];
    };
    const children = (current.content || []).map((child) => renderAdfNode(child)).join('');

    switch (current.type) {
      case 'doc':
        return children;
      case 'paragraph':
        return `<p>${children}</p>`;
      case 'heading': {
        const level = Number(current.attrs?.level || 3);
        const safeLevel = Math.min(6, Math.max(1, level));
        return `<h${safeLevel}>${children}</h${safeLevel}>`;
      }
      case 'text':
        return renderMarks(current.text || '', current.marks);
      case 'emoji':
        return escapeHtml(
          (typeof current.attrs?.text === 'string' && current.attrs.text) ||
          (typeof current.attrs?.shortName === 'string' && current.attrs.shortName) ||
          '🙂',
        );
      case 'mention':
        return `<span class="jira-mention">@${escapeHtml(String(current.attrs?.text || 'user'))}</span>`;
      case 'status': {
        const text = escapeHtml(String(current.attrs?.text || 'Status'));
        const color = escapeHtml(String(current.attrs?.color || 'neutral'));
        return `<span class="jira-status jira-status-${color.toLowerCase()}">${text}</span>`;
      }
      case 'date': {
        const raw = current.attrs?.timestamp;
        const value = Number(raw);
        if (!Number.isFinite(value)) {
          return '';
        }

        return escapeHtml(new Date(value).toLocaleDateString('fr-FR'));
      }
      case 'bulletList':
        return `<ul>${children}</ul>`;
      case 'orderedList':
        return `<ol>${children}</ol>`;
      case 'listItem':
        return `<li>${children}</li>`;
      case 'table':
        return `<div class="jira-table-wrap"><table class="jira-table"><tbody>${children}</tbody></table></div>`;
      case 'tableRow':
        return `<tr>${children}</tr>`;
      case 'tableHeader':
        return `<th>${children}</th>`;
      case 'tableCell':
        return `<td>${children}</td>`;
      case 'blockquote':
        return `<blockquote>${children}</blockquote>`;
      case 'codeBlock':
        return `<pre><code>${children}</code></pre>`;
      case 'hardBreak':
        return '<br />';
      case 'rule':
        return '<hr />';
      case 'panel':
        return `<div class="jira-panel">${children}</div>`;
      case 'expand':
      case 'nestedExpand': {
        const title = escapeHtml(String(current.attrs?.title || 'Détails'));
        return `<details class="jira-expand"><summary>${title}</summary><div class="jira-expand-body">${children}</div></details>`;
      }
      case 'inlineCard':
      case 'blockCard': {
        const url = typeof current.attrs?.url === 'string' ? escapeHtml(current.attrs.url) : '#';
        const label = url === '#' ? 'Lien' : url;
        return `<a class="jira-card-link" href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`;
      }
      case 'mediaGroup':
      case 'mediaSingle':
        return `<div class="jira-media-group">${children}</div>`;
      case 'media': {
        const alt = escapeHtml(String(current.attrs?.alt || 'Média Jira'));
        const url = typeof current.attrs?.url === 'string' ? escapeHtml(current.attrs.url) : '';
        const mediaType = typeof current.attrs?.type === 'string' ? current.attrs.type.toLowerCase() : '';
        const isLikelyImage =
          mediaType === 'file' &&
          !!url &&
          /\.(png|jpe?g|gif|webp|bmp|svg)(\?.*)?$/i.test(url);

        if (isLikelyImage) {
          return `<img class="jira-media-image" src="${url}" alt="${alt}" loading="lazy" />`;
        }

        if (url) {
          return `<a class="jira-media-link" href="${url}" target="_blank" rel="noopener noreferrer">${alt}</a>`;
        }

        return `<span class="jira-media-placeholder">${alt}</span>`;
      }
      default:
        return children;
    }
  };

  try {
    const { data } = await api.get(`/sessions/${requireSessionId()}/issues/${encodeURIComponent(activeKey)}`);
    activeTicketTitle.value = data.item.summary || activeKey;
    activeTicketDescription.value = (data.item.description || '').trim();
    activeTicketDescriptionHtml.value = data.item.descriptionAdf
      ? renderAdfNode(data.item.descriptionAdf)
      : '';
    activeTicketBrowseUrl.value = data.item.browseUrl || '#';
  } catch {
    activeTicketTitle.value = sessionStore.session?.activeTicket?.summary || activeKey;
    activeTicketDescription.value = '';
    activeTicketDescriptionHtml.value = '';
    activeTicketBrowseUrl.value = '#';
  }
};

const maybeLaunchFireworks = () => {
  if (!sessionStore.session || sessionStore.session.phase !== 'REVEALED') {
    return;
  }

  const voters = activeParticipants.value;
  if (voters.length === 0 || !sessionStore.session.revealedVotes) {
    return;
  }

  const revealedValues = voters.map((participant) => sessionStore.session?.revealedVotes?.[participant.userId]);

  if (revealedValues.some((value) => !value)) {
    return;
  }

  if (new Set(revealedValues as string[]).size !== 1) {
    return;
  }

  const canvas = fireworksCanvas.value;
  if (!canvas) {
    return;
  }

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return;
  }

  if (fireworksRafId) {
    cancelAnimationFrame(fireworksRafId);
    fireworksRafId = null;
  }
  if (fireworksTimeout) {
    clearTimeout(fireworksTimeout);
    fireworksTimeout = null;
  }

  if (fireworksAudio.value) {
    fireworksAudio.value.currentTime = 0;
    void fireworksAudio.value.play().catch(() => { });
  }

  isFireworksVisible.value = true;
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  type Rocket = { x: number; y: number; vx: number; vy: number; exploded: boolean };
  type Particle = { x: number; y: number; vx: number; vy: number; life: number; color: string };

  const rockets: Rocket[] = Array.from({ length: 12 }, () => ({
    x: canvas.width / 2 + (Math.random() * 28 - 14),
    y: canvas.height + 20,
    vx: Math.random() * 3 - 1.5,
    vy: -(9 + Math.random() * 5),
    exploded: false,
  }));
  const particles: Particle[] = [];
  const colors = ['#ff5252', '#ffd54f', '#4fc3f7', '#69f0ae', '#f06292', '#ffffff'];

  const explode = (x: number, y: number) => {
    const count = 68 + Math.floor(Math.random() * 32);
    for (let i = 0; i < count; i += 1) {
      const angle = (Math.PI * 2 * i) / count;
      const speed = 1.8 + Math.random() * 4.5;
      particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0.8 + Math.random() * 0.9,
        color: colors[Math.floor(Math.random() * colors.length)],
      });
    }
  };

  const startedAt = performance.now();
  const durationMs = 9600;

  const tick = (now: number) => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    rockets.forEach((rocket) => {
      if (rocket.exploded) {
        return;
      }

      rocket.x += rocket.vx;
      rocket.y += rocket.vy;
      rocket.vy += 0.18;

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(rocket.x - 1.5, rocket.y - 6, 3, 6);

      if (rocket.vy > -1 || rocket.y < canvas.height * 0.28) {
        rocket.exploded = true;
        explode(rocket.x, rocket.y);
      }
    });

    for (let i = particles.length - 1; i >= 0; i -= 1) {
      const particle = particles[i];
      particle.x += particle.vx;
      particle.y += particle.vy;
      particle.vy += 0.05;
      particle.life -= 0.009;

      if (particle.life <= 0) {
        particles.splice(i, 1);
        continue;
      }

      ctx.globalAlpha = Math.max(0, particle.life);
      ctx.fillStyle = particle.color;
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, 2.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    const elapsed = now - startedAt;
    if (elapsed < durationMs || particles.length > 0 || rockets.some((rocket) => !rocket.exploded)) {
      fireworksRafId = requestAnimationFrame(tick);
      return;
    }

    fireworksRafId = null;
    isFireworksVisible.value = false;
  };

  fireworksRafId = requestAnimationFrame(tick);
  fireworksTimeout = setTimeout(() => {
    if (fireworksRafId) {
      cancelAnimationFrame(fireworksRafId);
      fireworksRafId = null;
    }
    isFireworksVisible.value = false;
  }, 12000);
};

const handleWindowKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
    if (isDescriptionDialogOpen.value) {
      isDescriptionDialogOpen.value = false;
    }
    if (isEmojiPanelOpen.value) {
      isEmojiPanelOpen.value = false;
    }
  }
};

const handleWindowPointerDown = (event: PointerEvent) => {
  if (!isEmojiPanelOpen.value) {
    return;
  }

  const target = event.target as HTMLElement | null;

  if (target?.closest('.avatarActionWrap')) {
    return;
  }

  isEmojiPanelOpen.value = false;
};

const toggleEmojiPanel = () => {
  isEmojiPanelOpen.value = !isEmojiPanelOpen.value;
};

const findAvatarAnchorPosition = (userId: string) => {
  const selector = `.avatarActionWrap[data-user-id="${CSS.escape(userId)}"]`;
  const element = document.querySelector(selector) as HTMLElement | null;

  if (!element) {
    return {
      x: window.innerWidth / 2,
      y: window.innerHeight * 0.72,
    };
  }

  const rect = element.getBoundingClientRect();
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };
};

const launchEmojiReactionFx = (userId: string, emoji: string) => {
  const canvas = emojiFxCanvas.value;
  if (!canvas) {
    return;
  }

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return;
  }

  const { x: startX, y: startY } = findAvatarAnchorPosition(userId);

  if (emojiFxRafId) {
    cancelAnimationFrame(emojiFxRafId);
    emojiFxRafId = null;
  }
  if (emojiFxTimeout) {
    clearTimeout(emojiFxTimeout);
    emojiFxTimeout = null;
  }

  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  isEmojiFxVisible.value = true;

  type EmojiParticle = { x: number; y: number; vx: number; vy: number; life: number; size: number };
  const particles: EmojiParticle[] = Array.from({ length: 23 }, () => {
    const angle = Math.random() * Math.PI * 2;
    const speed = 1.4 + Math.random() * 4.2;
    return {
      x: startX,
      y: startY,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 2.2,
      life: 0.9 + Math.random() * 0.8,
      size: 18 + Math.random() * 14,
    };
  });

  const startedAt = performance.now();
  const durationMs = 1760;

  const tick = (now: number) => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles.forEach((particle) => {
      particle.x += particle.vx;
      particle.y += particle.vy;
      particle.vy += 0.08;
      particle.life -= 0.014;
    });

    for (let i = particles.length - 1; i >= 0; i -= 1) {
      const particle = particles[i];
      if (particle.life <= 0) {
        particles.splice(i, 1);
        continue;
      }

      ctx.globalAlpha = Math.max(0, particle.life);
      ctx.font = `${Math.round(particle.size)}px "Segoe UI Emoji", "Apple Color Emoji", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(emoji, particle.x, particle.y);
      ctx.globalAlpha = 1;
    }

    if (now - startedAt < durationMs && particles.length > 0) {
      emojiFxRafId = requestAnimationFrame(tick);
      return;
    }

    emojiFxRafId = null;
    isEmojiFxVisible.value = false;
  };

  emojiFxRafId = requestAnimationFrame(tick);
  emojiFxTimeout = setTimeout(() => {
    if (emojiFxRafId) {
      cancelAnimationFrame(emojiFxRafId);
      emojiFxRafId = null;
    }
    isEmojiFxVisible.value = false;
  }, 2240);
};

const sendReaction = async (emoji: string) => {
  if (isReactionCoolingDown.value || !sessionStore.session) {
    return;
  }

  isEmojiPanelOpen.value = false;
  isReactionCoolingDown.value = true;
  reactionCooldownLeft.value = 2;
  if (reactionCooldownInterval) {
    clearInterval(reactionCooldownInterval);
  }
  reactionCooldownInterval = setInterval(() => {
    reactionCooldownLeft.value = Math.max(0, reactionCooldownLeft.value - 1);
    if (reactionCooldownLeft.value === 0 && reactionCooldownInterval) {
      clearInterval(reactionCooldownInterval);
      reactionCooldownInterval = null;
    }
  }, 1000);

  try {
    await api.post(`/sessions/${sessionStore.session.id}/reaction`, { emoji });
  } catch {
    // no-op: server may reject due to cooldown
  } finally {
    setTimeout(() => {
      isReactionCoolingDown.value = false;
      reactionCooldownLeft.value = 0;
      if (reactionCooldownInterval) {
        clearInterval(reactionCooldownInterval);
        reactionCooldownInterval = null;
      }
    }, 2000);
  }
};

const handleSessionReaction = (payload: { userId: string; emoji: string }) => {
  if (!payload?.userId || !payload?.emoji) {
    return;
  }

  launchEmojiReactionFx(payload.userId, payload.emoji);
};

const pingSession = async () => {
  if (!sessionStore.session) {
    return;
  }

  try {
    await api.post(`/sessions/${sessionStore.session.id}/ping`);
  } catch {
    // no-op: heartbeat best effort
  }
};

const resolveSessionId = async () => {
  if (sessionCodeFromRoute) {
    const { data } = await api.get(`/sessions/join/${sessionCodeFromRoute}`);
    resolvedSessionId.value = data.session.id;
    return;
  }

  if (sessionIdFromRoute) {
    resolvedSessionId.value = sessionIdFromRoute;
    const { data } = await api.get(`/sessions/${sessionIdFromRoute}`);
    if (data?.session?.code) {
      await router.replace(`/session/${data.session.code}`);
    }
    return;
  }

  throw new Error('SESSION_NOT_FOUND');
};

watch(
  () => sessionStore.session?.voteStats?.suggestedStoryPoints,
  (suggested) => {
    if (suggested) {
      storyPoints.value = suggested;
    }
  },
  { immediate: true },
);

watch(
  () => isClosing.value,
  (value) => {
    if (!value) {
      hasAutoRedirected.value = false;
    }
    if (closingInterval) {
      clearInterval(closingInterval);
      closingInterval = null;
    }

    if (!value) {
      return;
    }

    refreshClosingCountdown();
    closingInterval = setInterval(refreshClosingCountdown, 1000);
  },
  { immediate: true },
);

watch(
  () => closingCountdown.value,
  async (value) => {
    if (!isClosing.value || value > 0 || hasAutoRedirected.value) {
      return;
    }

    hasAutoRedirected.value = true;
    await goHome();
  },
);

watch(
  () => sessionStore.session?.activeTicket?.jiraIssueKey,
  async () => {
    await loadActiveTicketDetails();
  },
  { immediate: true },
);

watch(
  () => sessionStore.session?.phase,
  (phase, previousPhase) => {
    if (phase === 'REVEALED' && previousPhase !== 'REVEALED') {
      maybeLaunchFireworks();
    }
  },
);

onMounted(async () => {
  window.addEventListener('keydown', handleWindowKeydown);
  window.addEventListener('pointerdown', handleWindowPointerDown);
  socket.on('session:reaction', handleSessionReaction);
  await resolveSessionId();
  const currentSessionId = requireSessionId();
  await sessionStore.join(currentSessionId);
  await pingSession();
  sessionPingInterval = setInterval(() => {
    pingSession().catch(() => {});
  }, 10_000);
  sessionStore.bindRealtime(currentSessionId);
  await loadActiveTicketDetails();
});

onUnmounted(async () => {
  if (fireworksRafId) {
    cancelAnimationFrame(fireworksRafId);
  }
  if (fireworksTimeout) {
    clearTimeout(fireworksTimeout);
  }
  if (emojiFxRafId) {
    cancelAnimationFrame(emojiFxRafId);
  }
  if (emojiFxTimeout) {
    clearTimeout(emojiFxTimeout);
  }
  if (reactionCooldownInterval) {
    clearInterval(reactionCooldownInterval);
  }
  if (sessionPingInterval) {
    clearInterval(sessionPingInterval);
    sessionPingInterval = null;
  }
  window.removeEventListener('keydown', handleWindowKeydown);
  window.removeEventListener('pointerdown', handleWindowPointerDown);
  socket.off('session:reaction', handleSessionReaction);
  if (closingInterval) {
    clearInterval(closingInterval);
  }
  const currentSessionId = getSessionId();
  if (currentSessionId) {
    sessionStore.unbindRealtime(currentSessionId);
    await sessionStore.leave(currentSessionId);
  }
});
</script>

<style scoped>
.pokerLayout {
  display: grid;
  gap: 14px;
  max-width: none;
  width: 100%;
}

.pokerHeader {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

.pokerHeader h1 {
  margin: 0;
}

.sessionMeta {
  margin: 2px 0 0;
  color: #56708a;
}

.headerActions {
  display: flex;
  gap: 8px;
}

.pokerGrid {
  display: grid;
  grid-template-columns: 280px 1fr 320px;
  gap: 12px;
}

.sideCol,
.centerCol {
  min-height: 520px;
}

.centerCol {
  --playing-card-width: clamp(62px, 6vw, 112px);
  --playing-card-height: calc(var(--playing-card-width) * 1.42);
}

.boxTitle {
  font-weight: 700;
  color: #1e3d5a;
  margin-bottom: 10px;
}

.participantsTitle {
  margin-top: 16px;
}

.currentUserCard {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}

.avatar {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: #e4eef9;
  border: 1px solid #bfd3ea;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  color: #204767;
  overflow: hidden;
}

.avatar.small {
  width: 56px;
  height: 56px;
  font-size: 19px;
}

.avatarImage {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.name {
  font-weight: 600;
}

.role {
  font-size: 12px;
  color: #607b96;
}

.participantsList {
  display: grid;
  gap: 8px;
}

.participantRow {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 8px;
  align-items: center;
  padding: 8px;
  border: 1px solid #dde8f4;
  border-radius: 8px;
  background: #f8fbff;
}

.participantMain {
  display: flex;
  align-items: center;
  gap: 8px;
}

.hostBadge {
  margin-left: 6px;
  font-size: 11px;
  background: #e7f6ec;
  border: 1px solid #bfe4cc;
  color: #236842;
  padding: 1px 6px;
  border-radius: 999px;
}

.activeStory {
  border: 1px solid #dce7f3;
  border-radius: 10px;
  background: #f8fbff;
  padding: 12px;
  margin-bottom: 12px;
}

.activeTicketKey,
.storyKey {
  color: #0f4c8a;
  font-weight: 700;
  text-decoration: none;
}

.activeTicketSummary {
  margin-top: 6px;
}

.activeTicketTitle {
  margin-top: 8px;
  font-size: 20px;
  font-weight: 700;
  line-height: 1.3;
  color: #1a3550;
}

.activeTicketDescriptionExcerpt {
  margin-top: 8px;
  color: #3e5870;
  font-size: 13px;
  line-height: 1.45;
}

.readMoreLink {
  margin-top: 6px;
  display: block;
  border: 0;
  background: transparent;
  color: #0f4c8a;
  cursor: pointer;
  padding: 0;
  text-decoration: underline;
}

.emptyText {
  color: #607b96;
}

.votersBoard {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 10px;
  margin-bottom: 30px;
}

.voterItem {
  display: grid;
  justify-items: center;
  gap: 28px;
  width: calc(var(--playing-card-width) + 28px);
}

.avatarActionWrap {
  position: relative;
  display: inline-flex;
}

.avatarBubbleButton {
  position: absolute;
  top: -10px;
  right: -10px;
  width: 27px;
  height: 27px;
  border-radius: 50%;
  border: 1px solid #536579;
  background: #ffffff;
  color: #3e4f61;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  line-height: 0;
  padding: 0;
  z-index: 2;
  cursor: pointer;
}

.avatarBubbleButton:disabled {
  cursor: not-allowed;
}

.avatarBubbleButton.cooldown {
  background: #e8edf3;
  border-color: #8a99aa;
  color: #4b5c6d;
}

.avatarCooldownText {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
}

.emojiPanel {
  position: absolute;
  top: -8px;
  left: calc(100% + 8px);
  z-index: 8;
  background: #ffffff;
  border: 1px solid #c8d8ea;
  border-radius: 10px;
  box-shadow: 0 10px 24px rgba(19, 38, 60, 0.2);
  padding: 8px;
  display: grid;
  grid-template-columns: repeat(5, minmax(30px, 1fr));
  gap: 6px;
  min-width: 188px;
}

.emojiButton {
  width: 32px;
  height: 32px;
  padding: 0;
  border-radius: 8px;
  border: 1px solid #d1ddeb;
  background: #f8fbff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  line-height: 1;
}

.emojiButton:hover:not(:disabled) {
  background: #eef6ff;
  border-color: #9dc0e7;
}

.avatarBubbleDots {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
}

.avatarBubbleDots .dot {
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: #2f3f52;
}

.voteCard {
  width: var(--playing-card-width);
  height: var(--playing-card-height);
  position: relative;
  border: 2px solid #1f3d5f;
  border-radius: 10px;
  background: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: clamp(24px, calc(var(--playing-card-width) * 0.34), 56px);
  color: #123a63;
  box-shadow:
    0 6px 12px rgba(16, 38, 61, 0.22),
    inset 0 0 0 1px #f0f4f9;
}

.voteCard.isFaceDown,
.voteButton.isFaceDown {
  background:
    radial-gradient(circle at 24% 20%, rgba(255, 255, 255, 0.28) 0 10%, transparent 12%),
    radial-gradient(circle at 76% 78%, rgba(255, 255, 255, 0.2) 0 9%, transparent 11%),
    repeating-linear-gradient(45deg, #1b3f64 0 10px, #2b5b8d 10px 20px);
  border-color: #1a3b5c;
  color: transparent;
}

.voteCard.isDisabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.voteCard.isFaceDown::before,
.voteCard.isFaceDown::after,
.voteButton.isFaceDown::before,
.voteButton.isFaceDown::after {
  display: none;
}

.coffeeImage {
  width: 100%;
  height: 100%;
  object-fit: contain;
  padding: 10px;
}

.voteCard::before,
.voteCard::after {
  content: '♠';
  position: absolute;
  font-size: clamp(15px, calc(var(--playing-card-width) * 0.1875), 36px);
  color: #7e8fa1;
  line-height: 1;
}

.voteCard::before {
  top: 5px;
  left: 6px;
}

.voteCard::after {
  bottom: 5px;
  right: 6px;
  transform: rotate(180deg);
}

.voterName {
  text-align: center;
  font-size: 12px;
}

.voteValues {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: center;
}

.voteButton {
  width: var(--playing-card-width);
  height: var(--playing-card-height);
  position: relative;
  border: 2px solid #1f3d5f;
  border-radius: 10px;
  background: #fff;
  color: #123a63;
  font-size: clamp(24px, calc(var(--playing-card-width) * 0.34), 56px);
  font-weight: 700;
  box-shadow:
    0 6px 12px rgba(16, 38, 61, 0.22),
    inset 0 0 0 1px #f0f4f9;
}

.voteButton::before,
.voteButton::after {
  content: '♠';
  position: absolute;
  font-size: clamp(15px, calc(var(--playing-card-width) * 0.1875), 36px);
  color: #7e8fa1;
  line-height: 1;
}

.voteButton::before {
  top: 5px;
  left: 6px;
}

.voteButton::after {
  bottom: 5px;
  right: 6px;
  transform: rotate(180deg);
}

.voteButton:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow:
    0 8px 14px rgba(16, 38, 61, 0.26),
    inset 0 0 0 1px #f0f4f9;
}

.voteButton.active {
  background: linear-gradient(160deg, #e7f2ff 0%, #d0e6ff 100%);
  border-color: #0f4f8e;
  color: #0f4f8e;
}

.resultsBox {
  display: grid;
  gap: 10px;
}

.resultBars {
  display: grid;
  gap: 6px;
}

.resultRow {
  display: grid;
  grid-template-columns: 70px 1fr 28px;
  align-items: center;
  gap: 8px;
}

.resultTrack {
  height: 12px;
  border-radius: 6px;
  background: #e6eef7;
  overflow: hidden;
}

.resultFill {
  height: 100%;
  border-radius: 6px;
  background: linear-gradient(90deg, #1576d6, #35a0ff);
}

.summaryLine {
  display: flex;
  gap: 10px;
  font-size: 13px;
}

.hostActions,
.hostPrimary {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
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

.hostActions input {
  width: 120px;
}

.storiesList {
  display: grid;
  gap: 8px;
}

.storyRow {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 8px;
  align-items: center;
  border: 1px solid #dde8f4;
  border-radius: 8px;
  background: #f8fbff;
  padding: 10px;
}

.storyRow.active {
  border-color: #8ab2da;
  background: #eef6ff;
}

.storySummary {
  margin-top: 4px;
  font-size: 13px;
  color: #243c52;
}

.tiny {
  padding: 6px 8px;
  font-size: 12px;
}

.closingBanner {
  border: 1px solid #f2d1a5;
  background: #fff4e5;
  color: #744c1f;
  padding: 10px 12px;
  border-radius: 8px;
}

.errorText {
  margin: 0;
  color: #a32b2b;
}

.dialogOverlay {
  position: fixed;
  inset: 0;
  background: rgba(17, 33, 52, 0.44);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
  padding: 20px;
}

.dialogCard {
  width: min(70vw, 100%);
  max-height: 80vh;
  background: #ffffff;
  border-radius: 12px;
  border: 1px solid #cfe0f0;
  box-shadow: 0 16px 38px rgba(14, 31, 51, 0.3);
  display: grid;
  grid-template-rows: auto 1fr;
  overflow: hidden;
}

.dialogHeader {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 14px;
  border-bottom: 1px solid #e0eaf5;
}

.dialogHeader h3 {
  margin: 0;
  font-size: 17px;
}

.dialogBody {
  padding: 14px;
  overflow-y: auto;
  overflow-x: hidden;
  white-space: pre-wrap;
  line-height: 1.5;
  color: #1f3347;
}

.dialogBody :deep(p) {
  margin: 0 0 10px;
}

.dialogBody :deep(ul),
.dialogBody :deep(ol) {
  margin: 0 0 10px 18px;
}

.dialogBody :deep(h1),
.dialogBody :deep(h2),
.dialogBody :deep(h3),
.dialogBody :deep(h4),
.dialogBody :deep(h5),
.dialogBody :deep(h6) {
  margin: 6px 0 10px;
  line-height: 1.3;
}

.dialogBody :deep(blockquote) {
  margin: 0 0 10px;
  padding-left: 10px;
  border-left: 3px solid #bfd4ea;
  color: #35516b;
}

.dialogBody :deep(pre) {
  margin: 0 0 10px;
  background: #f3f8fd;
  border: 1px solid #d9e6f2;
  border-radius: 8px;
  padding: 10px;
  overflow: auto;
}

.dialogBody :deep(code) {
  font-family: Consolas, monospace;
}

.dialogBody :deep(hr) {
  border: 0;
  border-top: 1px solid #d9e4ef;
  margin: 10px 0;
}

.dialogBody :deep(.jira-panel) {
  margin: 0 0 10px;
  padding: 10px;
  border-radius: 8px;
  border: 1px solid #d7e6f4;
  background: #f7fbff;
}

.dialogBody :deep(.jira-mention) {
  display: inline-block;
  background: #eaf3ff;
  border: 1px solid #c6dcfb;
  color: #1a4f8a;
  border-radius: 999px;
  padding: 1px 7px;
  font-size: 12px;
}

.dialogBody :deep(.jira-status) {
  display: inline-block;
  border-radius: 999px;
  padding: 1px 8px;
  font-size: 12px;
  font-weight: 600;
  border: 1px solid #d7e6f4;
  background: #f4f9ff;
  color: #35516b;
}

.dialogBody :deep(.jira-status-green) {
  background: #e7f8ef;
  border-color: #bce7cc;
  color: #1f6a3d;
}

.dialogBody :deep(.jira-status-blue) {
  background: #e7f1ff;
  border-color: #c8dcfb;
  color: #1c4f8e;
}

.dialogBody :deep(.jira-status-yellow) {
  background: #fff6db;
  border-color: #f4df9f;
  color: #7a5a17;
}

.dialogBody :deep(.jira-status-red) {
  background: #ffe8e8;
  border-color: #f3c5c5;
  color: #8f2727;
}

.dialogBody :deep(.jira-status-purple) {
  background: #f2eaff;
  border-color: #dbc8fb;
  color: #59358c;
}

.dialogBody :deep(.jira-table-wrap) {
  overflow: auto;
  margin-bottom: 10px;
}

.dialogBody :deep(.jira-table) {
  width: 100%;
  border-collapse: collapse;
}

.dialogBody :deep(.jira-table th),
.dialogBody :deep(.jira-table td) {
  border: 1px solid #d8e4f1;
  padding: 8px;
  vertical-align: top;
}

.dialogBody :deep(.jira-table th) {
  background: #f2f7fd;
  text-align: left;
}

.dialogBody :deep(.jira-expand) {
  margin: 0 0 10px;
  border: 1px solid #d7e4f1;
  border-radius: 8px;
  background: #f8fbff;
  padding: 8px 10px;
}

.dialogBody :deep(.jira-expand summary) {
  cursor: pointer;
  font-weight: 600;
}

.dialogBody :deep(.jira-expand-body) {
  margin-top: 8px;
}

.dialogBody :deep(.jira-card-link) {
  display: inline-block;
  margin: 0 0 10px;
  padding: 6px 10px;
  border: 1px solid #d5e3f1;
  border-radius: 8px;
  background: #f8fbff;
  text-decoration: none;
}

.dialogBody :deep(.jira-media-group) {
  margin: 0 0 10px;
  display: grid;
  gap: 6px;
}

.dialogBody :deep(.jira-media-link),
.dialogBody :deep(.jira-media-placeholder) {
  display: inline-block;
  padding: 6px 10px;
  border-radius: 8px;
  border: 1px solid #d4e2f0;
  background: #f8fbff;
  color: #35516b;
  text-decoration: none;
}

.dialogBody :deep(.jira-media-image) {
  max-width: min(100%, 680px);
  max-height: 360px;
  border-radius: 10px;
  border: 1px solid #d4e2f0;
  display: block;
  background: #ffffff;
  object-fit: contain;
}

.fireworksCanvas {
  position: fixed;
  inset: 0;
  z-index: 70;
  pointer-events: none;
}

@media (max-width: 1200px) {
  .pokerGrid {
    grid-template-columns: 1fr;
  }
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>





