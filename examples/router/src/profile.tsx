import type { ProfileVM } from "./profile.vm";

export default function ProfileView(this: { vm: ProfileVM }) {
  return (
    <section class="profile">
      <h3>Профиль</h3>
      <p class="user-badge">Пользователь: {this.vm.label}</p>
      <p>
        Этот дочерний view загружен динамическим <code>import()</code> через{" "}
        <code>load()</code> route-класса и отрендерен во вложенном{" "}
        <code>RouterView</code>.
      </p>
    </section>
  );
}
