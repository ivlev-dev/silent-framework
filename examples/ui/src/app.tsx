import {
  Show,
  createEffect,
  createResource,
  createSignal,
  onCleanup,
} from "@ivlev-dev/silent-core";
import {
  applyTheme,
  readStoredTheme,
  Avatar,
  IconButton,
  NavigationBar,
  NavigationRail,
  Snackbar,
  TopAppBar,
  type NavigationBarItemData,
  type NavigationRailItemData,
  type ThemeMode,
} from "@ivlev-dev/silent-ui";
import { getMeta } from "./api/client.js";
import { DashboardPage } from "./pages/dashboard.js";
import { ProjectsPage } from "./pages/projects.js";
import { SettingsPage, type AppDensity } from "./pages/settings.js";
import { TeamPage } from "./pages/team.js";
import {
  DashboardIcon,
  FolderIcon,
  MoonIcon,
  SettingsIcon,
  SunIcon,
  TeamIcon,
} from "./ui/icons.js";
import {
  dismissToast,
  toastMessage,
  toastOpen,
  toastTone,
} from "./ui/toast.js";

const SECTION_KEYS = ["dashboard", "projects", "team", "settings"] as const;
type SectionKey = (typeof SECTION_KEYS)[number];

const SECTION_TITLES: Readonly<Record<SectionKey, string>> = {
  dashboard: "Dashboard",
  projects: "Проекты",
  team: "Команда",
  settings: "Настройки",
};

const DENSITY_STORAGE_KEY = "silent-ui-density";

function isSectionKey(value: string): value is SectionKey {
  return (SECTION_KEYS as readonly string[]).includes(value);
}

function readSection(): SectionKey {
  if (typeof window === "undefined") return "dashboard";
  const raw = window.location.hash.replace(/^#\/?/u, "");
  return isSectionKey(raw) ? raw : "dashboard";
}

function readDensity(): AppDensity {
  if (typeof localStorage === "undefined") return "standard";
  try {
    return localStorage.getItem(DENSITY_STORAGE_KEY) === "compact"
      ? "compact"
      : "standard";
  } catch {
    return "standard";
  }
}

const NAV_ITEMS: readonly (NavigationRailItemData & NavigationBarItemData)[] = [
  { key: "dashboard", label: "Dashboard", icon: () => <DashboardIcon /> },
  { key: "projects", label: "Проекты", icon: () => <FolderIcon /> },
  { key: "team", label: "Команда", icon: () => <TeamIcon /> },
  { key: "settings", label: "Настройки", icon: () => <SettingsIcon /> },
];

export function App(): Node {
  const [section, setSection] = createSignal<SectionKey>(readSection());
  const [theme, setTheme] = createSignal<ThemeMode>(readStoredTheme() ?? "auto");
  const [density, setDensity] = createSignal<AppDensity>(readDensity());

  const meta = createResource(({ signal }) => getMeta(signal), { cache: false });

  const navigate = (key: string): void => {
    if (!isSectionKey(key)) return;
    setSection(key);
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", `#/${key}`);
    }
  };

  const onHashChange = (): void => {
    setSection(readSection());
  };
  if (typeof window !== "undefined") {
    window.addEventListener("hashchange", onHashChange);
    onCleanup(() => {
      window.removeEventListener("hashchange", onHashChange);
    });
  }

  createEffect(() => {
    applyTheme({ theme: theme(), persist: true });
    if (typeof document !== "undefined") {
      document.title = `${SECTION_TITLES[section()]} — Silent Projects`;
    }
  });

  createEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    if (density() === "compact") {
      root.setAttribute("data-density", "compact");
    } else {
      root.removeAttribute("data-density");
    }
    try {
      localStorage.setItem(DENSITY_STORAGE_KEY, density());
    } catch {
      // Приватный режим: плотность всё равно применена.
    }
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
            <span class="app-rail-brand__text">Silent Projects</span>
          </div>
        }
      />

      <div class="app__main">
        <TopAppBar
          title={SECTION_TITLES[section()]}
          sticky
          elevated
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

        <main class="app__content" id="main-content" tabindex="-1">
          <Show when={section() === "dashboard"}>
            <DashboardPage
              meta={meta}
              onOpenProjects={() => {
                navigate("projects");
              }}
            />
          </Show>
          <Show when={section() === "projects"}>
            <ProjectsPage meta={meta} />
          </Show>
          <Show when={section() === "team"}>
            <TeamPage meta={meta} />
          </Show>
          <Show when={section() === "settings"}>
            <SettingsPage
              meta={meta}
              theme={theme}
              onThemeChange={(next) => setTheme(next)}
              density={density}
              onDensityChange={(next) => setDensity(next)}
            />
          </Show>
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
