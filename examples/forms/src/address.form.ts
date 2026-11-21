import {
  Field,
  Form,
  Label,
  Placeholder,
  Required,
} from "@ivlev-dev/silent-form";

/** Вложенная форма адреса: подключается в профиль как поле. */
export class AddressForm extends Form {
  @Field()
  @Label("Город")
  @Placeholder("Москва")
  @Required()
  public accessor city = "";

  @Field()
  @Label("Регион")
  @Placeholder("Выберите регион")
  @Required()
  public accessor state = "";
}
