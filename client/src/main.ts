import './styles/tokens.css';
import './styles/fonts.css';
import './styles/base.css';
import { mount } from 'svelte';
import App from './App.svelte';
import { router } from './lib/router.svelte.ts';
import { profile } from './state/profile.svelte.ts';
import { theme } from './state/theme.svelte.ts';

// Order matters: the theme attribute and the route must be settled before the first render (NF-14, F-02).
theme.init();
router.start({ hasProfile: () => profile.id !== null });

const target = document.getElementById('app');
if (!target) throw new Error('Mount point #app is missing in index.html');
mount(App, { target });
