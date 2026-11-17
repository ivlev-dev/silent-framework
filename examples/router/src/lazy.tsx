import { Link } from "@ivlev-dev/silent-router";

export default function LazyView() {
  return (
    <section class="card">
      <h2>Ленивый маршрут</h2>
      <p>
        Этот view загружен динамическим <code>import()</code> через{" "}
        <code>load()</code> route-класса. Ссылка на него использует{" "}
        <code>prefetch</code>.
      </p>
      <Link to="/">На главную</Link>
    </section>
  );
}
