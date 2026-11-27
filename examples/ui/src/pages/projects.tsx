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
  Inline,
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
import { FilterIcon } from "../ui/icons.js";
import { createMediaQuery } from "../ui/media.js";
import { ErrorState, PageHeader } from "../ui/states.js";

function projectColumns(
  onDelete: (project: Project) => void,
): readonly DataTableColumn<Project>[] {
  return [
    {
      key: "name",
      header: "Название",
      width: 200,
      minWidth: 180,
      maxWidth: 380,
      sortable: true,
      truncate: true,
    },
    {
      key: "owner",
      header: "Владелец",
      width: 150,
      minWidth: 130,
      sortable: true,
      truncate: true,
    },
    {
      key: "status",
      header: "Статус",
      width: 140,
      minWidth: 120,
      sortable: true,
      render: (project) => (
        <Tag variant={statusVariant(project.status)} size="sm">
          {statusLabel(project.status)}
        </Tag>
      ),
    },
    {
      key: "tags",
      header: "Теги",
      width: 170,
      minWidth: 150,
      render: (project) => (
        <Inline gap={1} wrap>
          <For each={project.tags}>
            {(tag) => (
              <Tag size="sm" variant="neutral">
                #{tag}
              </Tag>
            )}
          </For>
        </Inline>
      ),
    },
    {
      key: "budget",
      header: "Бюджет",
      width: 140,
      minWidth: 120,
      align: "end",
      sortable: true,
      render: (project) => formatBudget(project.budget),
    },
    {
      key: "createdAt",
      header: "Создан",
      width: 130,
      minWidth: 110,
      align: "end",
      sortable: true,
      render: (project) => formatDate(project.createdAt),
    },
    {
      key: "actions",
      header: "Действия",
      width: 130,
      minWidth: 120,
      maxWidth: 160,
      align: "end",
      resizable: false,
      render: (project) => (
        <Button
          variant="text"
          size="sm"
          onClick={() => onDelete(project)}
          attrs={{ "aria-label": `Удалить проект «${project.name}»` }}
        >
          Удалить
        </Button>
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
    <FieldGroup columns={3} class="app-search-grid">
      <TextField
        type="search"
        field={searchForm.getFieldProps("q")}
        leading={<SearchIcon />}
        placeholder="Название или владелец"
        hint="Enter применяет фильтры"
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
        placeholder="—"
      />
      <NumberField
        field={searchForm.getFieldProps("budgetMax")}
        min={0}
        step={1000}
        unit="₽"
        placeholder="—"
      />
      <DateRangePicker
        class="app-search-grid__wide"
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

  const searchActions = (): Node => (
    <FormActions
      align="between"
      actions={
        <>
          <Inline gap={3} wrap align="center">
            <Button variant="text" onClick={resetFilters}>
              Сбросить
            </Button>
            <Text variant="body-small" tone="muted">
              Активных фильтров: {String(activeCount())}
            </Text>
          </Inline>
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
      {searchActions()}
    </form>
  );

  return (
    <Stack gap={4} class="app-page">
      <PageHeader
        title="Проекты"
        description="Серверная таблица: фильтры, сортировка, пагинация, выбор строк и CRUD."
        actions={
          <Button onClick={openCreate} leading={<FilterIcon />}>
            Новый проект
          </Button>
        }
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
          <Inline gap={2} wrap align="center" class="app-mobile-filters">
            <Button variant="tonal" onClick={() => setSheetOpen(true)} leading={<FilterIcon />}>
              Фильтры
            </Button>
            <Show when={activeCount() > 0}>
              <Tag variant="primary" size="sm">
                {String(activeCount())}
              </Tag>
            </Show>
            <Button variant="text" size="sm" onClick={resetFilters}>
              Сбросить
            </Button>
          </Inline>
        }
      >
        <Card variant="outlined" padding={4} class="app-search-card">
          <Stack gap={3}>
            <Inline justify="between" align="center" wrap gap={2}>
              <Inline gap={2} align="center">
                <FilterIcon />
                <Text variant="title-small">Фильтры</Text>
              </Inline>
              <Show when={activeCount() > 0}>
                <Tag variant="primary" size="sm">
                  Активно: {String(activeCount())}
                </Tag>
              </Show>
            </Inline>
            {searchFormView()}
          </Stack>
        </Card>
      </Show>

      <Show when={chips().length > 0}>
        <Inline gap={1} wrap class="app-active-filters">
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
          <Button variant="text" size="sm" onClick={resetFilters}>
            Сбросить всё
          </Button>
        </Inline>
      </Show>

      <Card variant="outlined" padding={0} class="app-table-card">
        <DataTable
          tableKey="projects"
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
          }}
          onSort={changeSort}
          onPageChange={changePage}
          onPageSizeChange={changePageSize}
          onRowClick={openEdit}
          toolbar={
            <Inline justify="between" align="center" wrap gap={2} class="app-table-toolbar">
              <Inline gap={2} wrap align="center">
                <Text variant="label-medium">
                  {String(total())} {total() === 1 ? "проект" : "проектов"}
                </Text>
                <Show when={selectedIds().length > 0}>
                  <Tag variant="primary" size="sm">
                    Выбрано: {String(selectedIds().length)}
                  </Tag>
                  <Button
                    variant="text"
                    size="sm"
                    onClick={() => setBulkDeleteOpen(true)}
                  >
                    Удалить выбранные
                  </Button>
                </Show>
              </Inline>
              <Inline gap={2} wrap align="center">
                <Show when={!isMobile()}>
                  <Button variant="text" size="sm" onClick={resetFilters}>
                    Сбросить фильтры
                  </Button>
                  <Button size="sm" onClick={openCreate}>
                    Создать
                  </Button>
                </Show>
              </Inline>
            </Inline>
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
