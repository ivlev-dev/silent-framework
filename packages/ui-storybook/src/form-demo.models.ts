import {
  Field as FormField,
  Form,
  Label,
  MinLength,
  Required,
} from "../../form/dist/index.js";

/**
 * Модели для story «FieldArray + настоящая Form».
 *
 * Вынесены из `*.stories.tsx`: индексатор Storybook разбирает файлы историй
 * Babel'ом без `decoratorAutoAccessors`, поэтому stage-3 декораторы и
 * `accessor`-поля живут в отдельном модуле. Импорт — из собранного пакета
 * (`dist`): этот же модуль типизирует `FormArray`/`FieldProps` внутри
 * `@ivlev-dev/silent-ui/form`, и подклассы `Form` совпадают с контрактом.
 */
export class OrderItemForm extends Form {
  @FormField()
  @Label("Название")
  @MinLength(2)
  public accessor name = "";

  @FormField()
  @Label("Количество")
  public accessor quantity = 1;
}

export class OrderForm extends Form {
  @FormField({ array: () => new OrderItemForm() })
  @Label("Позиции")
  @Required()
  public accessor items: OrderItemForm[] = [];
}
