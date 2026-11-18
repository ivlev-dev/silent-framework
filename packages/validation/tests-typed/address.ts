import { ValidationModel } from "../src/index.js";

export class Address extends ValidationModel {
  public accessor city: string = "";

  public accessor zip: number = 0;
}
