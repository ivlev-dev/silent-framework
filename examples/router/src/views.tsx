import { Link, RouterView } from "@ivlev-dev/silent-router";
import type { RouteViewProps } from "@ivlev-dev/silent-router";
import type { HomeVM } from "./home.vm";
import type { LoginVM } from "./login.vm";
import type { UserVM } from "./user.vm";

export type UserTab = "info" | "posts";

export function HomeView(this: { vm: HomeVM }) {
  return (
    <section class="card home">
      <h2>Главная</h2>
      <p class="user-badge">Пользователь: {this.vm.label}</p>
      <p>
        Демонстрация <code>@ivlev-dev/silent-router</code>: route-классы, вложенные
        layout-маршруты, guard с доступом к контейнеру, lazy-загрузка и DI.
      </p>
      <ul class="links">
        <li>
          <Link to="/private/profile">Приватный кабинет</Link>
        </li>
        <li>
          <Link to="/lazy" prefetch>
            Ленивый маршрут
          </Link>
        </li>
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
          <Link to="/about">О примере</Link>
        </li>
      </ul>
    </section>
  );
}

export function LoginView(this: { vm: LoginVM }) {
  return (
    <section class="card login">
      <h2>Вход</h2>
      <p>
        Приватный кабинет защищён guard-ом: без сессии роутер перенаправляет сюда и
        сохраняет исходный адрес в query <code>next</code>.
      </p>
      <p class="hint">
        После входа вернёмся на <code>{this.vm.next}</code>.
      </p>
      <button
        class="login-submit"
        onClick={() => {
          void this.vm.submit();
        }}
      >
        Войти
      </button>
    </section>
  );
}

export function AccountLayout() {
  return (
    <section class="card layout">
      <h2>Личный кабинет</h2>
      <p>
        Это layout защищённого раздела: guard проверяет <code>Session</code> из
        контейнера. Дочерний маршрут рендерится вложенным{" "}
        <code>RouterView depth=1</code> и подгружается лениво.
      </p>
      <div class="outlet">
        <RouterView
          depth={1}
          fallback={<p class="hint">Выберите раздел кабинета.</p>}
        />
      </div>
    </section>
  );
}

export function AboutView() {
  return (
    <section class="card about">
      <h2>О примере</h2>
      <p>
        Сервисы <code>Session</code> и <code>Router</code> создаются один раз и
        регистрируются в контейнере через <code>bindValue</code>. Контейнер работает
        в строгом режиме <code>implicitBindings: "error"</code>.
      </p>
      <p>
        Роутер, контейнер и view-model приходят через DI: guard получает{" "}
        <code>container</code>, а <code>RouterView</code> и <code>Link</code>{" "}
        находят роутер в текущем scope.
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
    <section class="card user">
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
        <button onClick={() => this.vm.next()}>Следующий: {this.vm.nextId}</button>
      </div>
      <p class="hint">
        Кнопка меняет <code>params</code>, не пересоздавая view.
      </p>
    </section>
  );
}

export function NotFoundView() {
  return (
    <section class="card not-found">
      <h2>Страница не найдена</h2>
      <p>Маршрут не совпал ни с одним правилом.</p>
      <Link to="/">На главную</Link>
    </section>
  );
}

export function LoadErrorView(props: { readonly error: unknown }) {
  const message =
    props.error instanceof Error ? props.error.message : String(props.error);
  return (
    <section class="card error-card">
      <h2>Ошибка навигации</h2>
      <p>{message}</p>
      <Link to="/">На главную</Link>
    </section>
  );
}
