import { defineStore } from 'pinia';
import { api } from '../services/api';
import { socket } from '../services/socket';

type Ticket = {
  id: string;
  jiraIssueKey: string;
  summary: string;
  isDone: boolean;
  finalStoryPoints: number | null;
  browseUrl?: string;
};

type Participant = {
  userId: string;
  isObserver: boolean;
  user: {
    displayName: string;
    avatarDataUrl: string | null;
  };
};

type SessionState = {
  id: string;
  name: string;
  code: string;
  phase: 'IDLE' | 'VOTING' | 'REVEALED' | 'CLOSING';
  status: 'ACTIVE' | 'CLOSING' | 'CLOSED';
  hostUserId: string;
  activeTicketId: string | null;
  activeTicket: Ticket | null;
  tickets: Ticket[];
  participants: Participant[];
  votedUserIds: string[];
  revealedVotes: Record<string, string> | null;
  voteStats: {
    countsByValue: Record<string, number>;
    minimum: number | null;
    maximum: number | null;
    average: number | null;
    suggestedStoryPoints: number | null;
  } | null;
  closingEndsAt: string | null;
  allowedVotes: string[];
  numericVotes: number[];
};

export const useSessionStore = defineStore('session', {
  state: () => ({
    session: null as SessionState | null,
  }),
  actions: {
    bindRealtime(sessionId: string) {
      socket.emit('session:join-room', { sessionId });
      socket.off('session:update');
      socket.on('session:update', (payload: SessionState | null) => {
        this.session = payload;
      });
    },

    unbindRealtime(sessionId: string) {
      socket.emit('session:leave-room', { sessionId });
      socket.off('session:update');
    },

    async fetch(sessionId: string) {
      const { data } = await api.get(`/sessions/${sessionId}`);
      this.session = data.session;
    },

    async join(sessionId: string) {
      await api.post(`/sessions/${sessionId}/join`);
      await this.fetch(sessionId);
    },

    async leave(sessionId: string) {
      await api.post(`/sessions/${sessionId}/leave`);
    },

    async vote(value: string) {
      if (!this.session) return;
      await api.post(`/sessions/${this.session.id}/vote`, { value });
    },
  },
});
