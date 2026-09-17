import './styles/global.css';
import { Router } from './core/router/router.ts';
import './components/basic-workbench/basic-workbench.ts';
import './components/about-page/about-page.ts';

// A project Pages site lives under /<repo>/, and Vite already knows the prefix —
// it is the `base` in vite.config.js, served by the dev server and the build
// alike. Taking it from import.meta.env.BASE_URL rather than hardcoding it means
// the repository name appears in exactly one place.
window.BOBA_BASE_URL = import.meta.env.BASE_URL;

const router = Router.getInstance();
router.registerRoute({ path: '/', component: 'basic-workbench' });
router.registerRoute({ path: '/about', component: 'about-page' });

// GitHub Pages serves 404.html for any path that is not a file, and the deploy
// workflow makes 404.html a byte-copy of index.html. A deep link therefore
// arrives here with the real path still in the URL bar, and the router reads it
// from there rather than from a redirect.
router.navigate(router.getAppPath());
