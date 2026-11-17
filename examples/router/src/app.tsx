import { Link, RouterView } from "@ivlev-dev/silent-router";
import type { AppVM } from "./app.vm";
import { LoadErrorView, NotFoundView } from "./views";

export function App(this: { vm: AppVM }, props: { title: string }) {
  return (
    <div class="app">
      <title>{props.title}</title>
      <header class="topbar">
        <h1>{props.title}</h1>
        <nav class="nav">
          <Link to="/" activeClass="nav-active" exactActiveClass="nav-exact">
            Главная
          </Link>
          <Link to="/private/profile" activeClass="nav-active">
            Приватный кабинет
          </Link>
          <Link to="/lazy" activeClass="nav-active" prefetch>
            Lazy
          </Link>
          <Link to="/about" activeClass="nav-active">
            О примере
          </Link>
          {this.vm.user === null ? (
            <Link to="/login" activeClass="nav-active">
              Войти
            </Link>
          ) : (
            <button class="nav-logout" onClick={() => this.vm.logout()}>
              Выйти
            </button>
          )}
        </nav>
        <div class="status" aria-live="polite">
          {this.vm.pending
            ? "Загрузка…"
            : `${this.vm.location} · ${this.vm.metaTitle} · ${this.vm.user ?? "гость"}`}
        </div>
      </header>
      <main class="content">
        <RouterView
          fallback={<p class="card">Маршрут не найден</p>}
          notFound={<NotFoundView />}
          error={(error: unknown) => <LoadErrorView error={error} />}
        />
      </main>
      <footer class="footer">
        <button onClick={() => this.vm.back()}>Назад</button>
        <span>Silent Router example</span>
      </footer>
    </div>
  );
}
