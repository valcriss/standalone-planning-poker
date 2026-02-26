<template>
  <AppHeader v-if="showHeader" />
  <router-view />
</template>

<script setup lang="ts">
/* istanbul ignore file */
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import AppHeader from './components/AppHeader.vue';

const route = useRoute();
const showHeader = computed(() => route.path !== '/login' && route.path !== '/register');
</script>
