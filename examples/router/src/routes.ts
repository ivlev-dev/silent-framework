import { Route, type RouteInput } from "@ivlev-dev/silent-router";
import { requireAuth } from "./guards";
import type { LoginQuery } from "./login.vm";
import {
  AboutView,
  AccountLayout,
  HomeView,
  LoginView,
  NotFoundView,
  UserView,
  type UserTab,
} from "./views";

export class HomeRoute extends Route {
  readonly path = "/";
  readonly name = "home";
  readonly component = HomeView;
  readonly meta = { title: "Главная" };
}

export class LoginRoute extends Route<"/login", LoginQuery> {
  readonly path = "/login";
  readonly name = "login";
  readonly component = LoginView;
  readonly query = { next: "string" as const };
  readonly meta = { title: "Вход" };
}

export class ProfileRoute extends Route {
  readonly path = "profile";
  readonly name = "profile";
  readonly meta = { title: "Профиль" };

  async load() {
    const module = await import("./profile");
    return module.default;
  }
}

export class PrivateRoute extends Route {
  readonly path = "/private";
  readonly name = "private";
  readonly component = AccountLayout;
  readonly redirect = "/private/profile";
  readonly beforeEnter = requireAuth;
  readonly meta = { title: "Кабинет" };
  readonly children: readonly RouteInput[] = [ProfileRoute];
}

export class LazyRoute extends Route {
  readonly path = "/lazy";
  readonly name = "lazy";
  readonly meta = { title: "Lazy" };

  async load() {
    const module = await import("./lazy");
    return module.default;
  }
}

export class AboutRoute extends Route {
  readonly path = "/about";
  readonly name = "about";
  readonly component = AboutView;
  readonly meta = { title: "О примере" };
}

export class UserRoute extends Route<"/users/{id}", { tab?: UserTab }> {
  readonly path = "/users/{id}";
  readonly name = "user";
  readonly component = UserView;
  readonly query = {
    tab: (raw: string | string[] | undefined): UserTab | undefined =>
      raw === "info" || raw === "posts" ? raw : undefined,
  };
  readonly meta = { title: "Пользователь" };
}

export class NotFoundRoute extends Route<"*"> {
  readonly path = "*";
  readonly name = "not-found";
  readonly component = NotFoundView;
  readonly meta = { title: "404" };
}

export const routes: readonly RouteInput[] = [
  HomeRoute,
  LoginRoute,
  PrivateRoute,
  LazyRoute,
  AboutRoute,
  UserRoute,
  NotFoundRoute,
];
