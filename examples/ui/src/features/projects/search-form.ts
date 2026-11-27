import {
  Field,
  Form,
  Label,
  Min,
  Optional,
  Placeholder,
} from "@ivlev-dev/silent-form";
import type { ProjectQuery, ProjectStatus } from "../../api/types.js";
import { isProjectStatus } from "../../lib/format.js";

export interface ProjectFilters {
  readonly q: string;
  readonly status: ProjectStatus | "";
  readonly owner: string;
  readonly tag: string;
  readonly budgetMin: number | null;
  readonly budgetMax: number | null;
  readonly createdFrom: string;
  readonly createdTo: string;
}

export const EMPTY_FILTERS: ProjectFilters = {
  q: "",
  status: "",
  owner: "",
  tag: "",
  budgetMin: null,
  budgetMax: null,
  createdFrom: "",
  createdTo: "",
};

export function countActiveFilters(filters: ProjectFilters): number {
  let count = 0;
  if (filters.q.trim() !== "") count += 1;
  if (filters.status !== "") count += 1;
  if (filters.owner !== "") count += 1;
  if (filters.tag !== "") count += 1;
  if (filters.budgetMin !== null) count += 1;
  if (filters.budgetMax !== null) count += 1;
  if (filters.createdFrom !== "" || filters.createdTo !== "") count += 1;
  return count;
}

export function filtersToQuery(
  filters: ProjectFilters,
  page: number,
  pageSize: number,
  sort: string,
  order: "asc" | "desc",
): ProjectQuery {
  return {
    page,
    pageSize,
    sort,
    order,
    q: filters.q.trim() === "" ? undefined : filters.q.trim(),
    status: filters.status === "" ? undefined : filters.status,
    owner: filters.owner === "" ? undefined : filters.owner,
    tag: filters.tag === "" ? undefined : filters.tag,
    budgetMin: filters.budgetMin ?? undefined,
    budgetMax: filters.budgetMax ?? undefined,
    createdFrom: filters.createdFrom === "" ? undefined : filters.createdFrom,
    createdTo: filters.createdTo === "" ? undefined : filters.createdTo,
  };
}

export class ProjectsSearchForm extends Form {
  @Field()
  @Label("Поиск")
  @Placeholder("Название или владелец")
  @Optional()
  public accessor q = "";

  @Field()
  @Label("Статус")
  @Optional()
  public accessor status = "";

  @Field()
  @Label("Владелец")
  @Optional()
  public accessor owner = "";

  @Field()
  @Label("Тег")
  @Optional()
  public accessor tag = "";

  @Field()
  @Label("Бюджет от")
  @Optional()
  @Min(0)
  public accessor budgetMin: number | null = null;

  @Field()
  @Label("Бюджет до")
  @Optional()
  @Min(0)
  public accessor budgetMax: number | null = null;

  @Field()
  @Label("Период создания")
  @Optional()
  public accessor dateFrom = "";

  @Field()
  @Label("Дата окончания")
  @Optional()
  public accessor dateTo = "";

  public constructor() {
    super({ formId: "projects-search", validateOnInput: true, debounceMs: 200 });
  }

  public readFilters(): ProjectFilters {
    const status = this.status;
    return {
      q: this.q,
      status: isProjectStatus(status) ? status : "",
      owner: this.owner,
      tag: this.tag,
      budgetMin: this.budgetMin,
      budgetMax: this.budgetMax,
      createdFrom: this.dateFrom,
      createdTo: this.dateTo,
    };
  }

  public async validateFilters(): Promise<boolean> {
    const self: ProjectsSearchForm = this;
    self.clearFieldErrors();

    if (
      self.budgetMin !== null &&
      self.budgetMax !== null &&
      self.budgetMax < self.budgetMin
    ) {
      self.setFieldErrors("budgetMax", "Максимум не может быть меньше минимума");
    }

    if (self.dateFrom !== "" && self.dateTo !== "" && self.dateTo < self.dateFrom) {
      self.setFieldErrors("dateTo", "Дата окончания раньше даты начала");
    }

    await self.validate();
    return self.isValid;
  }
}
