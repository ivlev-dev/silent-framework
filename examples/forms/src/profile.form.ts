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
import { AddressForm } from "./address.form";

export interface ProfileFields {
  name: string;
  email: string;
  age: number;
  avatar: string;
  address: AddressForm;
  interests: string;
}

/** Форма профиля: плоские поля, вложенная форма и поле с ручной готовностью. */
export class ProfileForm extends Form<ProfileFields> {
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
  @Hint("Загрузка файла...")
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
   * Симуляция загрузки файла: поле не готово к отправке, пока «загрузка»
   * не завершится. Таймер снимается в `reset` и `dispose`.
   */
  upload(file: File): void {
    const avatar = this.getFieldProps("avatar");
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
    this.getFieldProps("avatar").setReady(true);
  }
}
