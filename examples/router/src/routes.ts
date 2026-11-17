import { Route, type RouteInput } from "@ivlev-dev/silent-router";
import {
  AboutView,
  HomeView,
  NotFoundView,
  UserView,
  type UserTab,
} from "./views";

export class HomeRoute extends Route {
  readonly path = "/";
  readonly name = "home";
  readonly component = HomeView;
}

export class AboutRoute extends Route {
  readonly path = "/about";
  readonly name = "about";
  readonly component = AboutView;
}

export class UserRoute extends Route<"/users/{id}", { tab?: UserTab }> {
  readonly path = "/users/{id}";
  readonly name = "user";
  readonly component = UserView;
  readonly query = {
    tab: (raw: string | string[] | undefined): UserTab | undefined =>
      raw === "info" || raw === "posts" ? raw : undefined,
  };
}

export class LazyRoute extends Route {
  readonly path = "/lazy";
  readonly name = "lazy";

  async load() {
    const module = await import("./lazy");
    return module.default;
  }
}

export class NotFoundRoute extends Route<"*"> {
  readonly path = "*";
  readonly name = "not-found";
  readonly component = NotFoundView;
}

export const routes: readonly RouteInput[] = [
  HomeRoute,
  AboutRoute,
  UserRoute,
  LazyRoute,
  NotFoundRoute,
];
