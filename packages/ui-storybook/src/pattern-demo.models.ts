import {
  Equals,
  Field as FormField,
  Form,
  IsEmail,
  IsIn,
  Label,
  MinLength,
  Required,
} from "../../form/dist/index.js";

/**
 * Модели паттернов на настоящей `@ivlev-dev/silent-form`.
 *
 * Вынесены из `*.stories.tsx`: индексатор Storybook разбирает файлы историй
 * Babel'ом без `decoratorAutoAccessors`, поэтому декораторы и `accessor`-поля
 * не должны встречаться в самих историях. Импорт из `dist` совпадает с
 * модулем, которым типизирован `@ivlev-dev/silent-ui/form`.
 */

export class InviteForm extends Form {
  @FormField()
  @Label("Имя")
  @Required()
  @MinLength(2)
  public accessor name = "";

  @FormField()
  @Label("Email")
  @Required()
  @IsEmail()
  public accessor email = "";

  @FormField()
  @Label("Роль")
  @Required()
  @IsIn(["member", "admin"], { message: "Выберите роль из списка" })
  public accessor role = "";

  @FormField()
  @Label("Согласие")
  @Equals(true, { message: "Без согласия отправка невозможна" })
  public accessor consent = false;
}

export class LoginForm extends Form {
  @FormField()
  @Label("Email")
  @Required()
  @IsEmail()
  public accessor email = "ada@example.com";

  @FormField()
  @Label("Пароль")
  @Required()
  @MinLength(8)
  public accessor password = "";

  @FormField()
  @Label("Запомнить меня")
  public accessor remember = true;
}

export class SettingsForm extends Form {
  @FormField()
  @Label("Отображаемое имя")
  @MinLength(2)
  public accessor displayName = "Ада Ловлейс";

  @FormField()
  @Label("Дайджест на почту")
  public accessor digest = true;

  @FormField()
  @Label("Push-уведомления")
  public accessor push = false;

  @FormField()
  @Label("Плотность интерфейса")
  @IsIn(["compact", "default", "comfortable"])
  public accessor density = "default";
}
