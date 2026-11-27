import { Show, createEffect, onCleanup } from "@ivlev-dev/silent-core";
import {
  applyTheme,
  Avatar,
  IconButton,
  NavigationBar,
  NavigationRail,
  Snackbar,
  TopAppBar,
  type NavigationBarItemData,
  type NavigationRailItemData,
} from "@ivlev-dev/silent-ui";
import { RouterView, type Router } from "@ivlev-dev/silent-router";
import {
  ROUTE_PATHS,
  isSectionKey,
  prefetchRoutes,
  sectionFromPath,
  type SectionKey,
} from "../router/index.js";
import {
  density,
  persistDensity,
  setDensity,
  setTheme,
  theme,
} from "../theme.js";
import {
  DashboardIcon,
  FolderIcon,
  MoonIcon,
  SettingsIcon,
  SunIcon,
  TeamIcon,
} from "../../ui/icons.js";
import {
  dismissToast,
  toastMessage,
  toastOpen,
  toastTone,
} from "../../ui/toast.js";
import { SkeletonCards } from "../../ui/states.js";

export interface AppProps {
  readonly router: Router;
}

const SECTION_TITLES: Readonly<Record<SectionKey, string>> = {
  dashboard: "Dashboard",
  projects: "Проекты",
  team: "Команда",
  settings: "Настройки",
};

const NAV_ITEMS: readonly (NavigationRailItemData & NavigationBarItemData)[] = [
  { key: "dashboard", label: "Dashboard", icon: () => <DashboardIcon /> },
  { key: "projects", label: "Проекты", icon: () => <FolderIcon /> },
  { key: "team", label: "Команда", icon: () => <TeamIcon /> },
  { key: "settings", label: "Настройки", icon: () => <SettingsIcon /> },
];

function RouteFallback(): Node {
  return (
    <div class="app-route-fallback" aria-busy="true" aria-label="Загрузка раздела">
      <SkeletonCards count={4} />
    </div>
  );
}

export function App(props: AppProps): Node {
  const section = (): SectionKey => {
    const route = props.router.state().route;
    if (route === null) return "dashboard";
    return sectionFromPath(route.path);
  };

  const navigate = (key: string): void => {
    if (!isSectionKey(key)) return;
    if (section() === key) return;
    void props.router.push(ROUTE_PATHS[key]).catch(() => undefined);
  };

  createEffect(() => {
    applyTheme({ theme: theme(), persist: true });
    document.title = `${SECTION_TITLES[section()]} — Silent Projects`;
  });

  createEffect(() => {
    const value = density();
    const root = document.documentElement;
    if (value === "compact") {
      root.setAttribute("data-density", "compact");
    } else {
      root.removeAttribute("data-density");
    }
    persistDensity(value);
  });

  createEffect(() => {
    void section();
    let cancelled = false;
    const schedule = (): void => {
      if (!cancelled) prefetchRoutes(props.router);
    };
    const idle = window.requestIdleCallback;
    if (typeof idle === "function") {
      const handle = idle(schedule, { timeout: 2000 });
      onCleanup(() => {
        cancelled = true;
        window.cancelIdleCallback?.(handle);
      });
      return;
    }
    const timer = window.setTimeout(schedule, 1200);
    onCleanup(() => {
      cancelled = true;
      window.clearTimeout(timer);
    });
  });

  const toggleTheme = (): void => {
    setTheme(theme() === "dark" ? "light" : "dark");
  };

  return (
    <div class="app">
      <a class="app-skip" href="#main-content">
        Перейти к содержимому
      </a>

      <NavigationRail
        class="app__rail"
        items={NAV_ITEMS}
        value={section()}
        onValueChange={navigate}
        expanded
        label="Разделы приложения"
        fab={
          <div class="app-rail-brand">
            <span class="app-brand" aria-hidden="true">
              S
            </span>
          </div>
        }
      />

      <div class="app__main">
        <TopAppBar
          class="app-topbar"
          title="Silent Projects"
          sticky
          leading={
            <span class="app-topbar-brand" aria-hidden="true">
              S
            </span>
          }
          actions={
            <>
              <IconButton
                label={
                  theme() === "dark"
                    ? "Включить светлую тему"
                    : "Включить тёмную тему"
                }
                variant="standard"
                onClick={toggleTheme}
              >
                {theme() === "dark" ? <SunIcon /> : <MoonIcon />}
              </IconButton>
              <Avatar initials="АЛ" alt="Ада Ловлейс" size="md" status="online" />
            </>
          }
        />

        <Show when={props.router.state().pending}>
          <div class="app-route-progress" role="progressbar" aria-label="Загрузка раздела" />
        </Show>

        <main class="app__content" id="main-content" tabindex="-1">
          <RouterView router={props.router} fallback={<RouteFallback />} />
        </main>

        <NavigationBar
          class="app__bottom"
          items={NAV_ITEMS}
          value={section()}
          onValueChange={navigate}
          label="Разделы на мобильном"
        />
      </div>

      <Snackbar
        class="app-snackbar"
        open={toastOpen()}
        message={toastMessage()}
        autoHideDuration={4500}
        attrs={{ "data-tone": toastTone() }}
        onClose={dismissToast}
      />
    </div>
  );
}
