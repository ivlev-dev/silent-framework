import { createGuard } from "@ivlev-dev/silent-router";
import { Session } from "./session";

export const requireAuth = createGuard(({ container, to }) => {
  const session = container?.peek<Session>(Session);
  if (session === undefined) {
    throw new Error("Session не забинжена в контейнер приложения");
  }
  if (session.authenticated) {
    return true;
  }
  return `/login?next=${encodeURIComponent(to.fullPath)}`;
});
