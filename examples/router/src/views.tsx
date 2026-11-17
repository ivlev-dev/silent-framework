import type { RouteViewProps } from "@ivlev-dev/silent-router";
import { Link } from "@ivlev-dev/silent-router";
import type { UserVM } from "./user.vm";

export type UserTab = "info" | "posts";

export function HomeView() {
  return (
    <section class="card">
      <h2>Главная</h2>
      <p>
        Демонстрация <code>@ivlev-dev/silent-router</code>: route-классы, params,
        typed query, lazy-маршруты, prefetch и DI.
      </p>
      <ul class="links">
        <li>
          <Link to="/users/1" prefetch>
            Пользователь 1
          </Link>
        </li>
        <li>
          <Link to={{ name: "user", params: { id: 2 }, query: { tab: "posts" } }}>
            Пользователь 2, вкладка «Посты»
          </Link>
        </li>
        <li>
          <Link to="/lazy" prefetch>
            Ленивый маршрут
          </Link>
        </li>
      </ul>
    </section>
  );
}

export function AboutView() {
  return (
    <section class="card">
      <h2>О примере</h2>
      <p>
        Роутер получает зависимости через DI: <code>IRouter</code> подставляется и
        в ViewModel, и в компоненты <code>Link</code>/<code>RouterView</code>.
      </p>
      <p>
        При смене <code>params</code> и <code>query</code> view не пересоздаётся,
        поэтому введённый текст и focus сохраняются.
      </p>
    </section>
  );
}

export function UserView(
  this: { vm: UserVM },
  props: RouteViewProps<"/users/{id}", { tab?: UserTab }>,
) {
  const tab = (): UserTab => props.query.tab ?? "info";
  return (
    <section class="card">
      <h2>Пользователь {props.params.id}</h2>
      <nav class="tabs">
        <Link
          to={{
            name: "user",
            params: { id: props.params.id },
            query: { tab: "info" },
          }}
          activeClass="tab-active"
          exactActiveClass="tab-exact"
        >
          Инфо
        </Link>
        <Link
          to={{
            name: "user",
            params: { id: props.params.id },
            query: { tab: "posts" },
          }}
          activeClass="tab-active"
          exactActiveClass="tab-exact"
        >
          Посты
        </Link>
      </nav>
      <p class="badge">Вкладка: {tab()}</p>
      <div class="demo-form">
        <input placeholder="Введите заметку — она переживёт смену пользователя" />
        <button onClick={() => this.vm.next()}>
          Следующий: {this.vm.nextId}
        </button>
      </div>
      <p class="hint">
        Кнопка меняет <code>params</code>, не пересоздавая view.
      </p>
    </section>
  );
}

export function NotFoundView() {
  return (
    <section class="card">
      <h2>Страница не найдена</h2>
      <p>Маршрут не совпал ни с одним правилом.</p>
      <Link to="/">На главную</Link>
    </section>
  );
}
