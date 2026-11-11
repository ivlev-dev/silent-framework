export const SERVER_HOLE_SET_VALUE = "__silentServerHoleSetValue";

type ServerHoleValueSetter = (value: unknown) => boolean;

export function setServerHoleValue(hole: unknown, value: unknown): boolean {
  if (typeof hole !== "object" || hole === null) {
    return false;
  }
  const setter = (
    hole as Partial<Record<typeof SERVER_HOLE_SET_VALUE, ServerHoleValueSetter>>
  )[SERVER_HOLE_SET_VALUE];
  if (typeof setter !== "function") {
    return false;
  }
  return setter.call(hole, value) === true;
}
