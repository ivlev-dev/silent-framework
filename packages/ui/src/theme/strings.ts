/** Строки интерфейса по умолчанию (ru). Переопределяются через `UiConfigProvider`. */
export interface UiStrings {
  readonly close: string;
  readonly loading: string;
  readonly showPassword: string;
  readonly hidePassword: string;
  readonly required: string;
  readonly addItem: string;
  readonly removeItem: string;
  readonly moveUp: string;
  readonly moveDown: string;
  readonly submit: string;
  readonly reset: string;
  readonly chooseFile: string;
  readonly navigation: string;
  readonly actions: string;
  readonly breadcrumbs: string;
  readonly pagination: string;
  readonly previousPage: string;
  readonly nextPage: string;
  /** Шаблон статуса: `{page}` и `{pageCount}` подставляются компонентом. */
  readonly pageStatus: string;
  readonly search: string;
  readonly clear: string;
  readonly sortAscending: string;
  readonly sortDescending: string;
  readonly noData: string;
}

export const defaultUiStrings: UiStrings = {
  close: "Закрыть",
  loading: "Загрузка",
  showPassword: "Показать пароль",
  hidePassword: "Скрыть пароль",
  required: "Обязательное поле",
  addItem: "Добавить",
  removeItem: "Удалить",
  moveUp: "Переместить выше",
  moveDown: "Переместить ниже",
  submit: "Сохранить",
  reset: "Сбросить",
  chooseFile: "Выбрать файл",
  navigation: "Основная навигация",
  actions: "Действия",
  breadcrumbs: "Хлебные крошки",
  pagination: "Постраничная навигация",
  previousPage: "Назад",
  nextPage: "Вперёд",
  pageStatus: "Страница {page} из {pageCount}",
  search: "Поиск",
  clear: "Очистить",
  sortAscending: "По возрастанию",
  sortDescending: "По убыванию",
  noData: "Нет данных",
};

export const DEFAULT_LOCALE = "ru-RU";
