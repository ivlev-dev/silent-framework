import { Container } from "@ivlev-dev/silent-di";
import {
  Router,
  createBrowserHistory,
  createMemoryHistory,
  type RouterHistory,
} from "@ivlev-dev/silent-router";
import { AppVM } from "./app.vm";
import { HomeVM } from "./home.vm";
import { LoginVM } from "./login.vm";
import { ProfileVM } from "./profile.vm";
import { Session } from "./session";
import { UserVM } from "./user.vm";
import { routes } from "./routes";

export interface AppServices {
  readonly container: Container;
  readonly session: Session;
  readonly router: Router;
}

export interface AppServicesOptions {
  readonly initialUser?: string | null;
  readonly history?: RouterHistory;
}

const VIEW_MODELS = [AppVM, HomeVM, LoginVM, ProfileVM, UserVM] as const;

export function createAppServices(options: AppServicesOptions = {}): AppServices {
  const container = new Container("router-example", undefined, {
    implicitBindings: "error",
  });
  const session = new Session(options.initialUser ?? null);
  const router = new Router({
    routes,
    history: options.history ?? defaultHistory(),
    container,
  });
  const services: AppServices = { container, session, router };
  bindAppServices(container, services);
  return services;
}

export function bindAppServices(
  container: Container,
  services: Pick<AppServices, "session" | "router">,
): void {
  container.bindValue(Session, services.session);
  container.bindValue(Router, services.router);
  for (const viewModel of VIEW_MODELS) {
    container.bind(viewModel, viewModel).inTransientScope();
  }
}

let clientServices: AppServices | null = null;

export function appServices(): AppServices {
  clientServices ??= createAppServices();
  return clientServices;
}

function defaultHistory(): RouterHistory {
  return typeof window === "undefined"
    ? createMemoryHistory("/")
    : createBrowserHistory();
}
