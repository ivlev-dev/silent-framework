import { Link, RouterView } from "@ivlev-dev/silent-router";
import type { AppVM } from "./app.vm";

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
          <Link to="/about" activeClass="nav-active">
            О примере
          </Link>
          <Link to="/users/1" activeClass="nav-active">
            Пользователь
          </Link>
          <Link to="/lazy" activeClass="nav-active" prefetch>
            Lazy
          </Link>
          <Link to="/missing">404</Link>
        </nav>
        <div class="status" aria-live="polite">
          {this.vm.pending ? "Загрузка…" : this.vm.location}
        </div>
      </header>
      <main class="content">
        <RouterView fallback={<p class="card">Маршрут не найден</p>} />
      </main>
      <footer class="footer">
        <button onClick={() => this.vm.back()}>
          Назад
        </button>
        <span>Silent Router example</span>
      </footer>
    </div>
  );
}
