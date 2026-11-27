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
import { ProjectInput } from "../../api/types.js";
import type { ProjectStatus } from "../../api/types.js";

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
    const input = new ProjectInput();
    input.name = this.name.trim();
    input.owner = this.owner.trim();
    input.status = this.status;
    input.tags = this.tags.map((tag) => tag.trim()).filter((tag) => tag !== "");
    input.budget = this.budget ?? 0;
    return input;
  }
}
