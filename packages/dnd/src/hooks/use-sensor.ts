import type {
  Sensor,
  SensorDescriptor,
  SensorOptions,
} from "../runtime/types.js";

/**
 * Создаёт описание сенсора для `DndContext.sensors`.
 *
 * Опции не валидируются жёстко: сенсор сам решает, какие поля ему нужны, а
 * лишние ключи игнорируются. Это сохраняет совместимость с кастомными
 * сенсорами.
 */
export function useSensor<T extends SensorOptions>(
  sensor: Sensor<T>,
  options?: T,
): SensorDescriptor {
  return {
    sensor: sensor as Sensor,
    ...(options === undefined ? {} : { options: options as SensorOptions }),
  };
}

/** Собирает сенсоры в список, сохраняя порядок (первый активировавшийся). */
export function useSensors(
  ...sensors: readonly SensorDescriptor[]
): readonly SensorDescriptor[] {
  return sensors;
}
