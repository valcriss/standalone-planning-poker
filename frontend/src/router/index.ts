import { createRouter, createWebHistory } from 'vue-router';
import LoginView from '../views/LoginView.vue';
import HomeView from '../views/HomeView.vue';
import SessionView from '../views/SessionView.vue';
import AdminView from '../views/AdminView.vue';
import { useAuthStore } from '../stores/auth';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', component: LoginView },
    { path: '/', component: HomeView },
    { path: '/admin', component: AdminView },
    { path: '/join/:code', redirect: (to) => `/session/${String(to.params.code || '')}` },
    { path: '/session/:code', component: SessionView },
    { path: '/sessions/:id', component: SessionView },
  ],
});

router.beforeEach(async (to) => {
  const authStore = useAuthStore();

  if (!authStore.bootstrapped) {
    await authStore.bootstrap();
  }

  if (to.path === '/login' && authStore.isAuthenticated) {
    const redirect = typeof to.query.redirect === 'string' ? to.query.redirect : '';
    if (redirect.startsWith('/')) {
      return redirect;
    }
    return '/';
  }

  if (to.path !== '/login' && !authStore.isAuthenticated) {
    return {
      path: '/login',
      query: {
        redirect: to.fullPath,
      },
    };
  }

  if (to.path === '/admin' && authStore.user?.role !== 'ADMIN') {
    return '/';
  }

  return true;
});
