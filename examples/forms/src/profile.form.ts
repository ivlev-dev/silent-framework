import {
  Field,
  Form,
  FormField,
  Hint,
  IsEmail,
  Label,
  Max,
  Min,
  Placeholder,
  Required,
} from "@ivlev-dev/silent-form";
import type { FieldProps } from "@ivlev-dev/silent-form";
import { AddressForm } from "./address.form";

/** Форма профиля: плоские поля, вложенная форма и поле с ручной готовностью. */
export class ProfileForm extends Form {
  @Field()
  @Label("Имя")
  @Placeholder("Иван")
  @Hint("Как к вам обращаться")
  @Required()
  public accessor name = "";

  @Field()
  @Label("Email")
  @Placeholder("you@example.com")
  @Required()
  @IsEmail()
  public accessor email = "";

  @Field()
  @Label("Возраст")
  @Min(18)
  @Max(120)
  public accessor age = 18;

  @Field()
  @Label("Аватар")
  @Hint("PNG или JPG, до 2 МБ")
  public accessor avatar = "";

  @FormField()
  @Label("Адрес")
  public accessor address = new AddressForm();

  @Field()
  @Label("Интересы")
  @Placeholder("Музыка, спорт, кино")
  public accessor interests = "";

  private uploadTimer: ReturnType<typeof setTimeout> | undefined;

  /**
   * Полиморфный `this` в TypeScript не раскрывает `FieldPath<this>`,
   * поэтому внутри методов берём тип класса явно.
   */
  private avatarField(): FieldProps<string> {
    const self: ProfileForm = this;
    return self.getFieldProps("avatar");
  }

  /**
   * Симуляция загрузки файла: поле не готово к отправке, пока «загрузка»
   * не завершится. Таймер снимается в `reset` и `dispose`.
   */
  upload(file: File): void {
    const avatar = this.avatarField();
    this.clearUploadTimer();
    avatar.setReady(false);
    this.uploadTimer = setTimeout(() => {
      this.uploadTimer = undefined;
      avatar.setValue(file.name);
      avatar.setReady(true);
    }, 400);
  }

  override reset(): void {
    this.clearUploadTimer();
    super.reset();
    // Значение формы сброшено, но нативный `<input type="file">` хранит файл
    // отдельно от модели: очищаем его вручную. В SSR `document` отсутствует.
    if (typeof document === "undefined") {
      return;
    }
    const input = document.getElementById(this.avatarField().id);
    if (input instanceof HTMLInputElement) {
      input.value = "";
    }
  }

  override dispose(): void {
    this.clearUploadTimer();
    super.dispose();
  }

  private clearUploadTimer(): void {
    if (this.uploadTimer === undefined) {
      return;
    }
    clearTimeout(this.uploadTimer);
    this.uploadTimer = undefined;
    // Отменённая загрузка не должна навсегда оставлять поле неготовым.
    this.avatarField().setReady(true);
  }
}
