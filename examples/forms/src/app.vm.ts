import { reactive, ViewModel } from "@ivlev-dev/silent-core";
import { ProfileForm } from "./profile.form";

export class AppVM extends ViewModel {
  readonly form = new ProfileForm();

  @reactive accessor status = "";

  readonly submit = this.form.onSubmit(async (form) => {
    this.status = "";
    await new Promise((resolve) => setTimeout(resolve, 300));
    if (form.email === "taken@example.com") {
      form.setFieldErrors("email", "Этот email уже занят");
      return;
    }
    this.status = `Профиль сохранён: ${form.name}`;
  });

  override dispose(): void {
    this.form.dispose();
    super.dispose();
  }
}
