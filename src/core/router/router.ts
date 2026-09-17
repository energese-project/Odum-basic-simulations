export interface RouteMatch {
  path: string;
  params: Record<string, string>;
  query: Record<string, string>;
}

export interface Route {
  path: string;
  component: string;
  beforeEnter?: (to: RouteMatch) => boolean | string | Promise<boolean | string>;
}

interface CompiledRoute extends Route {
  regex: RegExp;
  paramNames: string[];
}

declare global {
  interface Window {
    BOBA_BASE_URL?: string;
  }
}

export class Router {
  private static instance: Router | undefined;
  private routes: CompiledRoute[] = [];
  currentPath = '';

  constructor() {
    window.addEventListener('popstate', () => {
      void this.handleRoute();
    });
  }

  static getInstance(): Router {
    if (!Router.instance) {
      Router.instance = new Router();
    }
    return Router.instance;
  }

  getAppPath(): string {
    const pathname = window.location.pathname;
    const baseUrl = window.BOBA_BASE_URL || '/';
    const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';

    if (pathname.startsWith(normalizedBaseUrl) && normalizedBaseUrl.length > 1) {
      let appPath = pathname.substring(normalizedBaseUrl.length);
      if (!appPath.startsWith('/')) {
        appPath = '/' + appPath;
      }
      return (appPath === '' ? '/' : appPath) + window.location.search;
    }
    return (pathname.startsWith('/') ? pathname : '/' + pathname) + window.location.search;
  }

  registerRoute(route: Route): void {
    const normalizedPath = route.path.startsWith('/') ? route.path : '/' + route.path;

    // '/user/:id' becomes /^\/user\/([^\/]+)$/, remembering the parameter names
    // in the order their groups appear.
    const paramNames: string[] = [];
    const regexSource = normalizedPath.replace(/:([^/]+)/g, (_, paramName: string) => {
      paramNames.push(paramName);
      return '([^\\/]+)';
    });

    this.routes.push({
      ...route,
      path: normalizedPath,
      regex: new RegExp(`^${regexSource}$`),
      paramNames,
    });
  }

  navigate(appPath: string): void {
    const pathAndQuery = appPath.startsWith('/') ? appPath : '/' + appPath;
    const baseUrl = window.BOBA_BASE_URL || '/';

    const [pathPart, queryString] = pathAndQuery.split('?');
    const dummyAbsoluteBase = 'http://dummy';
    const publicPath = new URL(
      pathPart.substring(1),
      dummyAbsoluteBase + (baseUrl.endsWith('/') ? baseUrl : baseUrl + '/')
    ).pathname;

    const finalPath = publicPath + (queryString ? '?' + queryString : '');

    if (window.location.pathname + window.location.search !== finalPath) {
      window.history.pushState({}, '', finalPath);
    }
    void this.handleRoute();
  }

  async handleRoute(): Promise<void> {
    const appPathToMatch = this.getAppPath();
    const [pathPart, queryString] = appPathToMatch.split('?');

    const searchParams = new URLSearchParams(queryString || '');
    const query = Object.fromEntries(searchParams.entries());

    const match = this.findRoute(pathPart);

    if (!match) {
      this.show404();
      return;
    }

    const to: RouteMatch = { path: pathPart, params: match.params, query };

    if (match.route.beforeEnter) {
      const guardResult = await match.route.beforeEnter(to);
      if (guardResult === false) {
        if (this.currentPath && this.currentPath !== appPathToMatch) {
          this.navigate(this.currentPath);
        }
        return;
      }
      if (typeof guardResult === 'string') {
        this.navigate(guardResult);
        return;
      }
    }

    this.currentPath = appPathToMatch;
    this.loadComponent(match.route.component, match.params, query);

    // Chrome-level components — the nav, and anything else outside the outlet —
    // have no other way to learn that the route moved. Without this they would
    // have to hook every link on the page individually, and would still miss
    // back/forward navigation.
    window.dispatchEvent(new CustomEvent<RouteMatch>('route-changed', { detail: to }));
  }

  findRoute(path: string): { route: CompiledRoute; params: Record<string, string> } | null {
    for (const route of this.routes) {
      const match = path.match(route.regex);
      if (match) {
        const params: Record<string, string> = {};
        route.paramNames.forEach((name, index) => {
          params[name] = decodeURIComponent(match[index + 1]);
        });
        return { route, params };
      }
    }
    return null;
  }

  loadComponent(
    tagName: string,
    params: Record<string, string> = {},
    query: Record<string, string> = {}
  ): void {
    const outlet = document.querySelector('#router-outlet');
    if (!outlet) return;

    // Every route component is imported eagerly by main.ts. Boba's router
    // imports them on demand instead, which is right for an app with many
    // routes and wrong for four pages of prose: the dynamic specifier is a
    // template literal, so Vite glob-imports the whole components directory
    // anyway, then warns that the dynamic import is ineffective because the
    // same modules are also reached statically. Requiring registration up front
    // is smaller, has no lazy-load flash between pages, and turns a missing
    // import into a visible 404 rather than a silent empty outlet.
    if (!customElements.get(tagName)) {
      console.error(`No custom element registered for <${tagName}>; import it in main.ts`);
      this.show404();
      return;
    }

    try {
      const element = document.createElement(tagName) as HTMLElement & {
        params?: Record<string, string>;
        query?: Record<string, string>;
      };
      Object.assign(element, params);
      element.params = params;
      element.query = query;

      outlet.innerHTML = '';
      outlet.appendChild(element);
      window.scrollTo({ top: 0 });
    } catch (error) {
      console.error(`Failed to load component: ${tagName}`, error);
      this.show404();
    }
  }

  show404(): void {
    const outlet = document.querySelector('#router-outlet');
    if (!outlet) return;
    // The href is the public path, not the app path: this markup is written
    // straight into the document, so the browser resolves it, not the router.
    const home = window.BOBA_BASE_URL || '/';
    outlet.innerHTML = `
      <div class="mx-auto max-w-5xl px-6 py-24 text-center">
        <p class="font-mono text-6xl font-bold text-[var(--e-accent)]">404</p>
        <h1 class="mt-4 text-2xl font-semibold">No such page</h1>
        <p class="mt-2 text-[var(--e-muted)]">That path is not part of this site.</p>
        <a href="${home}" class="mt-8 inline-block rounded-lg bg-[var(--e-accent)] px-5 py-2.5 text-sm font-medium text-[var(--e-ground)]">Back to the workbench</a>
      </div>
    `;
  }
}
