import {
  For,
  Show,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
} from "@ivlev-dev/silent-core";
import type { RouteViewProps } from "@ivlev-dev/silent-router";
import {
  AlertDialog,
  Button,
  Card,
  DataTable,
  DateRangePicker,
  Dialog,
  FieldGroup,
  FormActions,
  Heading,
  IconButton,
  Select,
  SearchIcon,
  Sheet,
  Stack,
  Tag,
  Text,
  TextField,
  type DataTableColumn,
  type DataTableSortDirection,
  type SelectOption,
} from "@ivlev-dev/silent-ui";
import { NumberField } from "@ivlev-dev/silent-ui/form/number-field";
import { TagInput } from "@ivlev-dev/silent-ui/form/tag-input";
import {
  createProject,
  deleteProject,
  errorMessage,
  isAbortError,
  listProjects,
  updateProject,
} from "../../api/client.js";
import type { Project, ProjectQuery } from "../../api/types.js";
import {
  PROJECT_STATUSES,
  formatBudget,
  formatDate,
  isProjectStatus,
  parseIsoDate,
  statusLabel,
  statusVariant,
  toIsoDate,
} from "../../lib/format.js";
import { ProjectForm } from "./project-form.js";
import {
  EMPTY_FILTERS,
  ProjectsSearchForm,
  countActiveFilters,
  filtersToQuery,
  type ProjectFilters,
} from "./search-form.js";
import { invalidateProjectData, projectMeta } from "../../app/data.js";
import { density } from "../../app/theme.js";
import { ROUTE_PATHS } from "../../app/router/routes.js";
import type { ProjectsRouteQuery } from "../../app/router/routes.js";
import { showToast } from "../../ui/toast.js";
import { FilterIcon, TrashIcon } from "../../ui/icons.js";
import { createMediaQuery } from "../../ui/media.js";
import { ErrorState, PageHeader } from "../../ui/states.js";
import { TagLine } from "../../ui/tags.js";
import {
  BulkDeleteAction,
  EmptyTable,
  TableError,
  TableToolbar,
} from "./table-parts.js";

function projectColumns(
  onDelete: (project: Project) => void,
): readonly DataTableColumn<Project>[] {
  return [
    {
      key: "name",
      header: "Название",
      width: 210,
      minWidth: 180,
      maxWidth: 380,
      sortable: true,
      truncate: true,
      card: { slot: "primary" },
      render: (project) => (
        <span class="app-cell-ellipsis" title={project.name}>
          {project.name}
        </span>
      ),
    },
    {
      key: "owner",
      header: "Владелец",
      width: 160,
      minWidth: 140,
      sortable: true,
      truncate: true,
      card: { slot: "secondary" },
      render: (project) => (
        <span class="app-cell-ellipsis" title={project.owner}>
          {project.owner}
        </span>
      ),
    },
    {
      key: "status",
      header: "Статус",
      width: 120,
      minWidth: 110,
      sortable: true,
      card: { slot: "badge" },
      render: (project) => (
        <Tag variant={statusVariant(project.status)} size="sm">
          {statusLabel(project.status)}
        </Tag>
      ),
    },
    {
      key: "tags",
      header: "Теги",
      width: 190,
      minWidth: 160,
      card: { slot: "meta", label: "Теги" },
      render: (project) => <TagLine tags={project.tags} />,
    },
    {
      key: "budget",
      header: "Бюджет",
      width: 136,
      minWidth: 128,
      align: "end",
      sortable: true,
      card: { slot: "meta", label: "Бюджет" },
      render: (project) => (
        <span class="app-num">{formatBudget(project.budget)}</span>
      ),
    },
    {
      key: "createdAt",
      header: "Создан",
      width: 128,
      minWidth: 120,
      align: "end",
      sortable: true,
      card: { slot: "meta", label: "Создан" },
      render: (project) => (
        <span class="app-num">{formatDate(project.createdAt)}</span>
      ),
    },
    {
      key: "actions",
      header: "",
      settingsLabel: "Действия",
      width: 64,
      minWidth: 56,
      maxWidth: 72,
      align: "end",
      resizable: false,
      locked: true,
      card: { slot: "actions" },
      render: (project) => (
        <IconButton
          label={`Удалить проект «${project.name}»`}
          size="sm"
          variant="standard"
          class="app-row-action"
          attrs={{ title: "Удалить проект" }}
          onClick={() => onDelete(project)}
        >
          <TrashIcon />
        </IconButton>
      ),
    },
  ];
}

const SORT_FIELDS = new Set(["name", "owner", "status", "budget", "createdAt"]);

interface FilterChip {
  readonly key: "q" | "status" | "owner" | "tag" | "budgetMin" | "budgetMax" | "period";
  readonly label: string;
}

function filterChips(filters: ProjectFilters): readonly FilterChip[] {
  const chips: FilterChip[] = [];
  if (filters.q.trim() !== "") {
    chips.push({ key: "q", label: `Поиск: ${filters.q.trim()}` });
  }
  if (isProjectStatus(filters.status)) {
    chips.push({ key: "status", label: `Статус: ${statusLabel(filters.status)}` });
  }
  if (filters.owner !== "") {
    chips.push({ key: "owner", label: `Владелец: ${filters.owner}` });
  }
  if (filters.tag !== "") {
    chips.push({ key: "tag", label: `Тег: #${filters.tag}` });
  }
  if (filters.budgetMin !== null) {
    chips.push({ key: "budgetMin", label: `Бюджет от ${formatBudget(filters.budgetMin)}` });
  }
  if (filters.budgetMax !== null) {
    chips.push({ key: "budgetMax", label: `Бюджет до ${formatBudget(filters.budgetMax)}` });
  }
  if (filters.createdFrom !== "" || filters.createdTo !== "") {
    chips.push({
      key: "period",
      label: `Период: ${filters.createdFrom === "" ? "…" : filters.createdFrom} — ${
        filters.createdTo === "" ? "…" : filters.createdTo
      }`,
    });
  }
  return chips;
}

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;

function filtersFromRoute(query: ProjectsRouteQuery): ProjectFilters {
  return {
    q: query.q ?? "",
    status: query.status ?? "",
    owner: query.owner ?? "",
    tag: query.tag ?? "",
    budgetMin: query.budgetMin ?? null,
    budgetMax: query.budgetMax ?? null,
    createdFrom: query.createdFrom ?? "",
    createdTo: query.createdTo ?? "",
  };
}

function resolvePageSize(value: number | undefined): number {
  return PAGE_SIZE_OPTIONS.find((size) => size === value) ?? 10;
}

function resolveSort(value: string | undefined): string {
  return value !== undefined && SORT_FIELDS.has(value) ? value : "createdAt";
}

function resolveDirection(value: "asc" | "desc" | undefined): DataTableSortDirection {
  return value === "asc" ? "ascending" : "descending";
}

function toRouteQuery(
  filters: ProjectFilters,
  page: number,
  pageSize: number,
  sortKey: string,
  direction: DataTableSortDirection,
): ProjectsRouteQuery {
  return {
    page,
    pageSize,
    sort: sortKey,
    order: direction === "ascending" ? "asc" : "desc",
    ...(filters.q.trim() !== "" ? { q: filters.q.trim() } : {}),
    ...(filters.status !== "" ? { status: filters.status } : {}),
    ...(filters.owner !== "" ? { owner: filters.owner } : {}),
    ...(filters.tag !== "" ? { tag: filters.tag } : {}),
    ...(filters.budgetMin !== null ? { budgetMin: filters.budgetMin } : {}),
    ...(filters.budgetMax !== null ? { budgetMax: filters.budgetMax } : {}),
    ...(filters.createdFrom !== "" ? { createdFrom: filters.createdFrom } : {}),
    ...(filters.createdTo !== "" ? { createdTo: filters.createdTo } : {}),
  };
}

function routeSignature(query: ProjectsRouteQuery): string {
  return JSON.stringify(query);
}

function applyFiltersToForm(
  form: ProjectsSearchForm,
  filters: ProjectFilters,
): void {
  form.getFieldProps("q").setValue(filters.q);
  form.getFieldProps("status").setValue(filters.status);
  form.getFieldProps("owner").setValue(filters.owner);
  form.getFieldProps("tag").setValue(filters.tag);
  form.getFieldProps("budgetMin").setValue(filters.budgetMin);
  form.getFieldProps("budgetMax").setValue(filters.budgetMax);
  form.getFieldProps("dateFrom").setValue(filters.createdFrom);
  form.getFieldProps("dateTo").setValue(filters.createdTo);
}

export type ProjectsPageProps = RouteViewProps<"/projects", ProjectsRouteQuery>;

export function ProjectsPage(props: ProjectsPageProps): Node {
  const meta = projectMeta();
  const compact = density() === "compact";
  const searchForm = new ProjectsSearchForm();
  const projectForm = new ProjectForm();
  onCleanup(() => {
    searchForm.dispose();
    projectForm.dispose();
  });

  const initialFilters = filtersFromRoute(props.query);
  applyFiltersToForm(searchForm, initialFilters);

  const [page, setPage] = createSignal(props.query.page ?? 1);
  const [pageSize, setPageSize] = createSignal(resolvePageSize(props.query.pageSize));
  const [sortKey, setSortKey] = createSignal(resolveSort(props.query.sort));
  const [sortDirection, setSortDirection] = createSignal<DataTableSortDirection>(
    resolveDirection(props.query.order),
  );
  const [filters, setFilters] = createSignal<ProjectFilters>(initialFilters);
  let syncedSignature = routeSignature(props.query);
  const [selected, setSelected] = createSignal<ReadonlySet<string | number>>(
    new Set(),
  );
  const [dialogOpen, setDialogOpen] = createSignal(false);
  const [editingId, setEditingId] = createSignal<number | null>(null);
  const [deleteTarget, setDeleteTarget] = createSignal<Project | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = createSignal(false);
  const [sheetOpen, setSheetOpen] = createSignal(false);

  const isMobile = createMediaQuery("(max-width: 959px)");

  const pushQuery = (
    nextFilters: ProjectFilters,
    nextPage: number,
    nextPageSize: number,
    nextSortKey: string,
    nextDirection: DataTableSortDirection,
  ): void => {
    const next = toRouteQuery(
      nextFilters,
      nextPage,
      nextPageSize,
      nextSortKey,
      nextDirection,
    );
    syncedSignature = routeSignature(next);
    void props.router
      .push({ path: ROUTE_PATHS.projects, query: next })
      .catch(() => undefined);
  };

  createEffect(() => {
    const nextQuery = props.query;
    const signature = routeSignature(nextQuery);
    if (signature === syncedSignature) return;
    syncedSignature = signature;
    const nextFilters = filtersFromRoute(nextQuery);
    setFilters(nextFilters);
    applyFiltersToForm(searchForm, nextFilters);
    setPage(nextQuery.page ?? 1);
    setPageSize(resolvePageSize(nextQuery.pageSize));
    setSortKey(resolveSort(nextQuery.sort));
    setSortDirection(resolveDirection(nextQuery.order));
    setSelected(new Set());
  });


  const query = createMemo<ProjectQuery>(() => {
    const key = sortKey();
    return filtersToQuery(
      filters(),
      page(),
      pageSize(),
      SORT_FIELDS.has(key) ? key : "createdAt",
      sortDirection() === "ascending" ? "asc" : "desc",
    );
  });
  const queryKey = createMemo(() => JSON.stringify(query()));

  const listing = createResource(
    ({ signal }) => listProjects(query(), signal),
    { key: queryKey, cache: false },
  );

  const rows = (): readonly Project[] => listing.data()?.items ?? [];
  const columns = projectColumns((project) => setDeleteTarget(project));
  const total = (): number => listing.data()?.total ?? 0;
  const activeCount = (): number => countActiveFilters(filters());
  const chips = (): readonly FilterChip[] => filterChips(filters());
  const selectedIds = (): readonly number[] =>
    [...selected()]
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value));

  const statusOptions = createMemo<readonly SelectOption[]>(() => [
    { value: "", label: "Все статусы" },
    ...PROJECT_STATUSES.map((status) => ({
      value: status,
      label: statusLabel(status),
    })),
  ]);
  const ownerOptions = createMemo<readonly SelectOption[]>(() => [
    { value: "", label: "Все владельцы" },
    ...(meta.data()?.owners ?? []).map((owner) => ({
      value: owner,
      label: owner,
    })),
  ]);
  const tagOptions = createMemo<readonly SelectOption[]>(() => [
    { value: "", label: "Все теги" },
    ...(meta.data()?.tags ?? []).map((tag) => ({
      value: tag,
      label: `#${tag}`,
    })),
  ]);

  const bulkDeleteAction = (
    <BulkDeleteAction onOpen={() => setBulkDeleteOpen(true)} />
  );
  const tableToolbar = (): Node => (
    <TableToolbar total={total} onCreate={openCreate} />
  );
  const tableEmpty = (): Node => (
    <EmptyTable
      activeCount={activeCount}
      onReset={resetFilters}
      onCreate={openCreate}
    />
  );
  const tableError = (): Node => (
    <TableError
      message={() => errorMessage(listing.error())}
      onRetry={() => {
        listing.refetch().catch(() => undefined);
      }}
    />
  );

  const applyFilters = async (): Promise<void> => {
    const valid = await searchForm.validateFilters();
    if (!valid) return;
    const nextFilters = searchForm.readFilters();
    setFilters(nextFilters);
    setPage(1);
    setSelected(new Set());
    setSheetOpen(false);
    pushQuery(nextFilters, 1, pageSize(), sortKey(), sortDirection());
  };

  const resetFilters = (): void => {
    searchForm.reset();
    searchForm.clearFieldErrors();
    setFilters(EMPTY_FILTERS);
    setPage(1);
    setSelected(new Set());
    setSheetOpen(false);
    pushQuery(EMPTY_FILTERS, 1, pageSize(), sortKey(), sortDirection());
  };

  const clearFilter = (key: FilterChip["key"]): void => {
    if (key === "q") searchForm.getFieldProps("q").setValue("");
    if (key === "status") searchForm.getFieldProps("status").setValue("");
    if (key === "owner") searchForm.getFieldProps("owner").setValue("");
    if (key === "tag") searchForm.getFieldProps("tag").setValue("");
    if (key === "budgetMin") searchForm.getFieldProps("budgetMin").setValue(null);
    if (key === "budgetMax") searchForm.getFieldProps("budgetMax").setValue(null);
    if (key === "period") {
      searchForm.getFieldProps("dateFrom").setValue("");
      searchForm.getFieldProps("dateTo").setValue("");
    }
    const nextFilters = searchForm.readFilters();
    setFilters(nextFilters);
    setPage(1);
    setSelected(new Set());
    pushQuery(nextFilters, 1, pageSize(), sortKey(), sortDirection());
  };

  const changePage = (next: number): void => {
    setPage(next);
    setSelected(new Set());
    pushQuery(filters(), next, pageSize(), sortKey(), sortDirection());
  };

  const changePageSize = (size: number): void => {
    setPageSize(size);
    setPage(1);
    setSelected(new Set());
    pushQuery(filters(), 1, size, sortKey(), sortDirection());
  };

  const changeSort = (key: string, direction: DataTableSortDirection): void => {
    setSortKey(key);
    setSortDirection(direction);
    setPage(1);
    setSelected(new Set());
    pushQuery(filters(), 1, pageSize(), key, direction);
  };

  const closeEditor = (): void => {
    if (projectForm.isSubmitting) return;
    setDialogOpen(false);
    setEditingId(null);
    projectForm.reset();
    projectForm.clearFieldErrors();
  };

  const openCreate = (): void => {
    projectForm.reset();
    projectForm.clearFieldErrors();
    projectForm.getFieldProps("owner").setValue(meta.data()?.owners[0] ?? "");
    projectForm.getFieldProps("status").setValue("active");
    projectForm.getFieldProps("budget").setValue(5000);
    setEditingId(null);
    setDialogOpen(true);
  };

  const openEdit = (project: Project): void => {
    projectForm.reset();
    projectForm.clearFieldErrors();
    projectForm.setValues({
      name: project.name,
      owner: project.owner,
      status: project.status,
      tags: project.tags,
      budget: project.budget,
    });
    setEditingId(project.id);
    setDialogOpen(true);
  };

  const refreshAfterRemoval = async (removed: number): Promise<void> => {
    const remaining = rows().length - removed;
    if (remaining <= 0 && page() > 1) {
      const nextPage = page() - 1;
      setPage(nextPage);
      pushQuery(filters(), nextPage, pageSize(), sortKey(), sortDirection());
      return;
    }
    await listing.refetch();
  };

  const saveProject = projectForm.onSubmit(async (form) => {
    const input = form.toInput();
    const id = editingId();
    try {
      if (id === null) {
        await createProject(input);
        showToast(`Проект «${input.name}» создан`, "success");
        setPage(1);
        pushQuery(filters(), 1, pageSize(), sortKey(), sortDirection());
      } else {
        await updateProject(id, input);
        showToast(`Проект «${input.name}» обновлён`, "success");
      }
      setDialogOpen(false);
      setEditingId(null);
      form.reset();
      invalidateProjectData();
      await listing.refetch();
    } catch (error) {
      if (isAbortError(error)) return;
      showToast(errorMessage(error), "error");
    }
  });

  const confirmDelete = async (): Promise<void> => {
    const target = deleteTarget();
    if (target === null) return;
    setDeleteTarget(null);
    try {
      await deleteProject(target.id);
      showToast(`Проект «${target.name}» удалён`, "success");
      invalidateProjectData();
      await refreshAfterRemoval(1);
    } catch (error) {
      if (isAbortError(error)) return;
      showToast(errorMessage(error), "error");
    }
  };

  const confirmBulkDelete = async (): Promise<void> => {
    const ids = selectedIds();
    setBulkDeleteOpen(false);
    if (ids.length === 0) return;
    try {
      await Promise.all(ids.map((id) => deleteProject(id)));
      showToast(`Удалено проектов: ${String(ids.length)}`, "success");
      setSelected(new Set());
      invalidateProjectData();
      await refreshAfterRemoval(ids.length);
    } catch (error) {
      if (isAbortError(error)) return;
      showToast(errorMessage(error), "error");
      await listing.refetch();
    }
  };

  const searchFields = (): Node => (
    <FieldGroup columns={3} class="app-filter-grid">
      <TextField
        class="app-field--search"
        type="search"
        field={searchForm.getFieldProps("q")}
        leading={<SearchIcon />}
        placeholder="Название или владелец"
      />
      <Select
        field={searchForm.getFieldProps("status")}
        options={statusOptions()}
        searchable={false}
        placeholder="Все статусы"
      />
      <Select
        field={searchForm.getFieldProps("owner")}
        options={ownerOptions()}
        loading={meta.pending()}
        searchable
        placeholder="Все владельцы"
      />
      <Select
        field={searchForm.getFieldProps("tag")}
        options={tagOptions()}
        loading={meta.pending()}
        searchable
        placeholder="Все теги"
      />
      <NumberField
        field={searchForm.getFieldProps("budgetMin")}
        min={0}
        step={1000}
        unit="₽"
        placeholder="0"
      />
      <NumberField
        field={searchForm.getFieldProps("budgetMax")}
        min={0}
        step={1000}
        unit="₽"
        placeholder="0"
      />
      <DateRangePicker
        class="app-field--period"
        label="Период создания"
        value={{
          start: parseIsoDate(searchForm.dateFrom),
          end: parseIsoDate(searchForm.dateTo),
        }}
        error={
          searchForm.getFieldProps("dateTo").error ??
          searchForm.getFieldProps("dateFrom").error
        }
        onValueChange={(range) => {
          searchForm.getFieldProps("dateFrom").setValue(toIsoDate(range.start));
          searchForm.getFieldProps("dateTo").setValue(toIsoDate(range.end));
        }}
      />
    </FieldGroup>
  );

  const chipsView = (): Node => (
    <div class="app-active-filters">
      <For each={chips()}>
        {(chip) => (
          <Tag
            variant="secondary"
            size="sm"
            removable
            removeLabel={`Убрать фильтр «${chip.label}»`}
            onRemove={() => clearFilter(chip.key)}
          >
            {chip.label}
          </Tag>
        )}
      </For>
    </div>
  );

  const searchActions = (): Node => (
    <FormActions
      align="between"
      class="app-filters__actions"
      actions={
        <>
          <div class="app-filters__status">
            <Button variant="text" onClick={resetFilters}>
              Сбросить
            </Button>
            <Text variant="body-small" tone="muted">
              Активных фильтров: {String(activeCount())}
            </Text>
          </div>
          <Button type="submit" leading={<FilterIcon />}>
            Применить
          </Button>
        </>
      }
    />
  );

  const searchFormView = (): Node => (
    <form
      class="app-search-form"
      novalidate
      onSubmit={(event) => {
        event.preventDefault();
        void applyFilters();
      }}
    >
      {searchFields()}
      <Show when={chips().length > 0}>{chipsView()}</Show>
      {searchActions()}
    </form>
  );

  return (
    <Stack gap={6} class="app-page">
      <PageHeader
        title="Проекты"
        description="Серверная таблица: фильтры, сортировка, пагинация, выбор строк и CRUD."
      />

      <Show when={meta.error() !== undefined}>
        <ErrorState
          title="Справочники недоступны"
          message={errorMessage(meta.error())}
          onRetry={() => {
            meta.refetch().catch(() => undefined);
          }}
        />
      </Show>

      <Show
        when={!isMobile()}
        fallback={
          <div class="app-mobile-filters">
            <Button
              variant="tonal"
              onClick={() => setSheetOpen(true)}
              leading={<FilterIcon />}
            >
              Фильтры
            </Button>
            <Show when={activeCount() > 0}>
              <Tag variant="primary" size="sm">
                {String(activeCount())}
              </Tag>
              <Button variant="text" size="sm" onClick={resetFilters}>
                Сбросить
              </Button>
            </Show>
          </div>
        }
      >
        <Card variant="outlined" padding={0} class="app-search-card">
          <div class="app-filters">
            <div class="app-filters__head">
              <div class="app-filters__title">
                <FilterIcon />
                <Heading level={3} variant="title-medium">
                  Фильтры
                </Heading>
              </div>
              <Show when={activeCount() > 0}>
                <Tag variant="primary" size="sm">
                  Активно: {String(activeCount())}
                </Tag>
              </Show>
            </div>
            {searchFormView()}
          </div>
        </Card>
      </Show>

      <Show when={isMobile() && chips().length > 0}>
        <div class="app-active-filters">{chipsView()}</div>
      </Show>

      <Card variant="outlined" padding={0} class="app-table-card">
        <DataTable
          tableKey="projects"
          class="app-projects-table"
          columns={columns}
          rows={rows()}
          rowKey={(project) => project.id}
          total={total()}
          page={page()}
          pageSize={pageSize()}
          pageSizeOptions={PAGE_SIZE_OPTIONS}
          sortKey={sortKey()}
          sortDirection={sortDirection()}
          loading={listing.pending()}
          density={compact ? "compact" : "standard"}
          error={listing.error() === undefined ? undefined : tableError()}
          empty={tableEmpty()}
          selection={{
            selected: selected(),
            onChange: setSelected,
            actions: bulkDeleteAction,
          }}
          onSort={changeSort}
          onPageChange={changePage}
          onPageSizeChange={changePageSize}
          onRowClick={openEdit}
          toolbar={tableToolbar()}
          attrs={{ "aria-label": "Таблица проектов" }}
        />
      </Card>

      <Show when={isMobile()}>
        <Sheet
          open={sheetOpen()}
          onOpenChange={setSheetOpen}
          side="bottom"
          title="Фильтры проектов"
          description="Выберите параметры и примените их к таблице."
          class="app-filter-sheet"
        >
          {searchFormView()}
        </Sheet>
      </Show>

      <Dialog
        open={dialogOpen()}
        onOpenChange={(open) => {
          if (!open) closeEditor();
        }}
        title={editingId() === null ? "Новый проект" : "Редактирование проекта"}
        description={
          editingId() === null
            ? "Заполните поля и создайте проект."
            : "Измените поля и сохраните изменения."
        }
        actions={
          <>
            <Button
              variant="text"
              disabled={projectForm.isSubmitting}
              onClick={closeEditor}
            >
              Отмена
            </Button>
            <Button
              type="submit"
              attrs={{ form: "project-form" }}
              loading={projectForm.isSubmitting}
            >
              {editingId() === null ? "Создать" : "Сохранить"}
            </Button>
          </>
        }
      >
        <form
          id="project-form"
          class="app-dialog-form"
          novalidate
          onSubmit={saveProject}
        >
          <TextField field={projectForm.getFieldProps("name")} />
          <FieldGroup columns={2}>
            <Select
              field={projectForm.getFieldProps("owner")}
              options={(meta.data()?.owners ?? []).map((owner) => ({
                value: owner,
                label: owner,
              }))}
              loading={meta.pending()}
              searchable
              placeholder="Выберите владельца"
            />
            <Select
              field={projectForm.getFieldProps("status")}
              options={PROJECT_STATUSES.map((status) => ({
                value: status,
                label: statusLabel(status),
              }))}
              searchable={false}
            />
          </FieldGroup>
          <TagInput
            field={projectForm.getFieldProps("tags")}
            suggestions={meta.data()?.tags ?? []}
            allowCustom
            hint="Введите тег и нажмите Enter"
          />
          <NumberField
            field={projectForm.getFieldProps("budget")}
            min={0}
            step={500}
            unit="₽"
            placeholder="Бюджет проекта"
          />
        </form>
      </Dialog>

      <AlertDialog
        open={deleteTarget() !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="Удалить проект?"
        description={
          deleteTarget() === null
            ? ""
            : `Проект «${deleteTarget()?.name ?? ""}» будет удалён без возможности восстановления.`
        }
        confirmLabel="Удалить"
        cancelLabel="Отмена"
        destructive
        onConfirm={() => {
          void confirmDelete();
        }}
        onCancel={() => setDeleteTarget(null)}
      />

      <AlertDialog
        open={bulkDeleteOpen()}
        onOpenChange={setBulkDeleteOpen}
        title="Удалить выбранные проекты?"
        description={`Будет удалено проектов: ${String(selectedIds().length)}. Действие необратимо.`}
        confirmLabel="Удалить"
        cancelLabel="Отмена"
        destructive
        onConfirm={() => {
          void confirmBulkDelete();
        }}
        onCancel={() => setBulkDeleteOpen(false)}
      />
    </Stack>
  );
}

export default ProjectsPage;
