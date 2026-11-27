import {
  Field,
  Form,
  IsEmail,
  IsUrl,
  Label,
  Matches,
  MaxLength,
  MinLength,
  Placeholder,
  Required,
} from "@ivlev-dev/silent-form";

export const SETTINGS_FIELD_COUNT = 15;

export class SettingsForm extends Form {
  @Field()
  @Label("Полное имя")
  @Placeholder("Как к вам обращаться")
  @Required()
  @MinLength(2)
  @MaxLength(120)
  public accessor fullName = "Ада Ловлейс";

  @Field()
  @Label("Email")
  @Placeholder("you@example.com")
  @Required()
  @IsEmail()
  public accessor email = "ada@silent.dev";

  @Field()
  @Label("Должность")
  @Required()
  public accessor role = "Руководитель дизайн-системы";

  @Field()
  @Label("Команда")
  @Required()
  public accessor team = "Платформа";

  @Field()
  @Label("Город")
  public accessor location = "Москва";

  @Field()
  @Label("Часовой пояс")
  public accessor timezone = "Europe/Moscow";

  @Field()
  @Label("Сайт")
  @Placeholder("https://example.com")
  @IsUrl()
  public accessor website = "https://silent.dev";

  @Field()
  @Label("О себе")
  @MaxLength(280)
  public accessor bio = "Собираю интерфейсы на Silent: дизайн-система, формы и доступность.";

  @Field()
  @Label("Акцентный цвет")
  @Required()
  @Matches(/^#[0-9a-fA-F]{6}$/u)
  public accessor accent = "#1F4E6B";

  @Field()
  @Label("День рождения")
  public accessor birthDate = "1994-04-12";

  @Field()
  @Label("Период планирования")
  public accessor planFrom = "2026-11-01";

  @Field()
  @Label("Дата окончания")
  public accessor planTo = "2026-12-31";

  @Field()
  @Label("Рабочие теги")
  public accessor tags: readonly string[] = ["ui", "design"];

  @Field()
  @Label("Уведомления")
  public accessor notifications = true;

  @Field()
  @Label("Публичный профиль")
  public accessor publicProfile = true;

  public constructor() {
    super({ formId: "settings", validateOnInput: true });
  }

  public completion(): {
    readonly filled: number;
    readonly total: number;
    readonly requiredFilled: number;
    readonly requiredTotal: number;
    readonly percent: number;
  } {
    const required = [this.fullName, this.email, this.role, this.team];
    const all = [
      ...required,
      this.location,
      this.timezone,
      this.website,
      this.bio,
      this.accent,
      this.birthDate,
      this.planFrom,
      this.planTo,
      this.tags.join(", "),
      this.notifications ? "on" : "off",
      this.publicProfile ? "on" : "off",
    ];
    const filled = all.filter((value) => value.trim() !== "").length;
    const requiredFilled = required.filter((value) => value.trim() !== "").length;
    const total = Math.max(SETTINGS_FIELD_COUNT, all.length);
    return {
      filled,
      total,
      requiredFilled,
      requiredTotal: required.length,
      percent: Math.round((filled / total) * 100),
    };
  }
}
