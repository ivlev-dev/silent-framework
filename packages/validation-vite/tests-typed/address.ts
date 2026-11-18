import { ValidationModel } from "@ivlev-dev/silent-validation";

export class Address extends ValidationModel {
  public accessor city: string = "";

  public accessor zip: number = 0;
}
