import {
  Field,
  Form,
  Label,
  Max,
  MaxLength,
  Min,
  MinLength,
  Placeholder,
  Required,
} from "@ivlev-dev/silent-form";
import type { ProjectInput, ProjectStatus } from "./api/types.js";

export class ProjectForm extends Form {
  @Field()
  @Label("Название")
  @Placeholder("Например, Платформа данных")
  @Required()
  @MinLength(2)
  @MaxLength(200)
  public accessor name = "";

  @Field()
  @Label("Владелец")
  @Required()
  public accessor owner = "";

  @Field()
  @Label("Статус")
  @Required()
  public accessor status: ProjectStatus = "active";

  @Field()
  @Label("Теги")
  public accessor tags: readonly string[] = [];

  @Field()
  @Label("Бюджет")
  @Required()
  @Min(0)
  @Max(1_000_000_000_000)
  public accessor budget: number | null = null;

  public constructor() {
    super({ formId: "project" });
  }

  public toInput(): ProjectInput {
    return {
      name: this.name.trim(),
      owner: this.owner.trim(),
      status: this.status,
      tags: this.tags.map((tag) => tag.trim()).filter((tag) => tag !== ""),
      budget: this.budget ?? 0,
    };
  }
}
