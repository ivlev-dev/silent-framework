import {
  For,
  Show,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
} from "@ivlev-dev/silent-core";
import type { Resource } from "@ivlev-dev/silent-core";
import {
  AlertDialog,
  Button,
  Card,
  DataTable,
  DateRangePicker,
  Dialog,
  EmptyState,
  FieldGroup,
  FormActions,
  Heading,
  IconButton,
  Inline,
  Select,
  SearchIcon,
  Sheet,
  Stack,
  Tag,
  Text,
  TextField,
  AddIcon,
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
} from "../api/client.js";
import type { Project, ProjectMeta, ProjectQuery } from "../api/types.js";
import {
  PROJECT_STATUSES,
  formatBudget,
  formatDate,
  isProjectStatus,
  parseIsoDate,
  statusLabel,
  statusVariant,
  toIsoDate,
} from "../lib/format.js";
import { ProjectForm } from "../project-form.js";
import {
  EMPTY_FILTERS,
  ProjectsSearchForm,
  countActiveFilters,
  filtersToQuery,
  type ProjectFilters,
} from "../search-form.js";
import { showToast } from "../ui/toast.js";
import { FilterIcon, TrashIcon } from "../ui/icons.js";
import { createMediaQuery } from "../ui/media.js";
import { ErrorState, PageHeader } from "../ui/states.js";
import { TagLine } from "../ui/tags.js";

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

export interface ProjectsPageProps {
  readonly meta: Resource<ProjectMeta>;
  readonly compact: boolean;
}

export function ProjectsPage(props: ProjectsPageProps): Node {
  const searchForm = new ProjectsSearchForm();
  const projectForm = new ProjectForm();
  onCleanup(() => {
    searchForm.dispose();
    projectForm.dispose();
  });

  const [page, setPage] = createSignal(1);
  const [pageSize, setPageSize] = createSignal(10);
  const [sortKey, setSortKey] = createSignal("createdAt");
  const [sortDirection, setSortDirection] =
    createSignal<DataTableSortDirection>("descending");
  const [filters, setFilters] = createSignal<ProjectFilters>(EMPTY_FILTERS);
  const [selected, setSelected] = createSignal<ReadonlySet<string | number>>(
    new Set(),
  );
  const [dialogOpen, setDialogOpen] = createSignal(false);
  const [editingId, setEditingId] = createSignal<number | null>(null);
  const [deleteTarget, setDeleteTarget] = createSignal<Project | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = createSignal(false);
  const [sheetOpen, setSheetOpen] = createSignal(false);

  const isMobile = createMediaQuery("(max-width: 959px)");


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

  const statusOptions: readonly SelectOption[] = [
    { value: "", label: "Все статусы" },
    ...PROJECT_STATUSES.map((status) => ({
      value: status,
      label: statusLabel(status),
    })),
  ];
  const ownerOptions = (): readonly SelectOption[] => [
    { value: "", label: "Все владельцы" },
    ...(props.meta.data()?.owners ?? []).map((owner) => ({
      value: owner,
      label: owner,
    })),
  ];
  const tagOptions = (): readonly SelectOption[] => [
    { value: "", label: "Все теги" },
    ...(props.meta.data()?.tags ?? []).map((tag) => ({
      value: tag,
      label: `#${tag}`,
    })),
  ];

  const applyFilters = async (): Promise<void> => {
    const valid = await searchForm.validateFilters();
    if (!valid) return;
    setFilters(searchForm.readFilters());
    setPage(1);
    setSelected(new Set());
    setSheetOpen(false);
  };

  const resetFilters = (): void => {
    searchForm.reset();
    searchForm.clearFieldErrors();
    setFilters(EMPTY_FILTERS);
    setPage(1);
    setSelected(new Set());
    setSheetOpen(false);
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
    setFilters(searchForm.readFilters());
    setPage(1);
    setSelected(new Set());
  };

  const changePage = (next: number): void => {
    setPage(next);
    setSelected(new Set());
  };

  const changePageSize = (size: number): void => {
    setPageSize(size);
    setPage(1);
    setSelected(new Set());
  };

  const changeSort = (key: string, direction: DataTableSortDirection): void => {
    setSortKey(key);
    setSortDirection(direction);
    setPage(1);
    setSelected(new Set());
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
    projectForm.getFieldProps("owner").setValue(props.meta.data()?.owners[0] ?? "");
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
      setPage(page() - 1);
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
      } else {
        await updateProject(id, input);
        showToast(`Проект «${input.name}» обновлён`, "success");
      }
      setDialogOpen(false);
      setEditingId(null);
      form.reset();
      await Promise.all([listing.refetch(), props.meta.refetch()]);
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
      await refreshAfterRemoval(1);
      await props.meta.refetch();
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
      await refreshAfterRemoval(ids.length);
      await props.meta.refetch();
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
        options={statusOptions}
        searchable={false}
        placeholder="Все статусы"
      />
      <Select
        field={searchForm.getFieldProps("owner")}
        options={ownerOptions()}
        loading={props.meta.pending()}
        searchable
        placeholder="Все владельцы"
      />
      <Select
        field={searchForm.getFieldProps("tag")}
        options={tagOptions()}
        loading={props.meta.pending()}
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

      <Show when={props.meta.error() !== undefined}>
        <ErrorState
          title="Справочники недоступны"
          message={errorMessage(props.meta.error())}
          onRetry={() => {
            props.meta.refetch().catch(() => undefined);
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
          pageSizeOptions={[10, 20, 50, 100]}
          sortKey={sortKey()}
          sortDirection={sortDirection()}
          loading={listing.pending()}
          density={props.compact ? "compact" : "standard"}
          error={
            listing.error() === undefined ? undefined : (
              <Inline gap={2} wrap align="center">
                <Text>{errorMessage(listing.error())}</Text>
                <Button
                  size="sm"
                  variant="tonal"
                  onClick={() => {
                    listing.refetch().catch(() => undefined);
                  }}
                >
                  Повторить
                </Button>
              </Inline>
            )
          }
          empty={
            <EmptyState
              compact
              title={activeCount() > 0 ? "Ничего не найдено" : "Пока нет проектов"}
              description={
                activeCount() > 0
                  ? "Измените фильтры или сбросьте их."
                  : "Создайте первый проект, чтобы начать работу."
              }
              actions={
                activeCount() > 0 ? (
                  <Button variant="tonal" size="sm" onClick={resetFilters}>
                    Сбросить фильтры
                  </Button>
                ) : (
                  <Button size="sm" onClick={openCreate}>
                    Создать проект
                  </Button>
                )
              }
            />
          }
          selection={{
            selected: selected(),
            onChange: setSelected,
            actions: (
              <Button
                size="sm"
                variant="filled"
                leading={<TrashIcon />}
                onClick={() => setBulkDeleteOpen(true)}
              >
                Удалить
              </Button>
            ),
          }}
          onSort={changeSort}
          onPageChange={changePage}
          onPageSizeChange={changePageSize}
          onRowClick={openEdit}
          toolbar={
            <div class="app-table-toolbar">
              <Inline justify="between" align="center" wrap gap={2}>
                <Inline gap={2} wrap align="center">
                  <Text variant="label-large" class="app-table-toolbar__count">
                    {String(total())} {total() === 1 ? "проект" : "проектов"}
                  </Text>
                </Inline>
                <Button size="sm" onClick={openCreate} leading={<AddIcon />}>
                  Новый проект
                </Button>
              </Inline>
            </div>
          }
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
              options={(props.meta.data()?.owners ?? []).map((owner) => ({
                value: owner,
                label: owner,
              }))}
              loading={props.meta.pending()}
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
            suggestions={props.meta.data()?.tags ?? []}
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
