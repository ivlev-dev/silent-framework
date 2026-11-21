import { reactive, ViewModel } from "@ivlev-dev/silent-core";
import { ProfileForm } from "./profile.form";

export class AppVM extends ViewModel {
  /** `formId` фиксирует DOM-идентификаторы и не зависит от имени класса при минификации. */
  readonly form = new ProfileForm({ formId: "profile" });

  @reactive accessor status = "";

  private disposed = false;

  readonly submit = this.form.onSubmit(async (form) => {
    if (this.disposed) {
      return;
    }
    this.status = "";
    await new Promise((resolve) => setTimeout(resolve, 300));
    if (this.disposed) {
      return;
    }
    if (form.email === "taken@example.com") {
      form.setFieldErrors("email", "Этот email уже занят");
      return;
    }
    this.status = `Профиль сохранён: ${form.name}`;
  });

  override dispose(): void {
    this.disposed = true;
    this.form.dispose();
    super.dispose();
  }
}
