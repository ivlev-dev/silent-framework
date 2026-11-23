import { registerFieldOption } from "./schema.js";
import type { FieldOptions, WireTypeName } from "./types.js";

export type ProtocolAccessorDecorator = <C extends object, V>(
  value: ClassAccessorDecoratorTarget<C, V>,
  context: ClassAccessorDecoratorContext<C, V>,
) => void;

function accessorDecorator(
  options: (field: string) => FieldOptions,
): ProtocolAccessorDecorator {
  return <C extends object, V>(
    _value: ClassAccessorDecoratorTarget<C, V>,
    context: ClassAccessorDecoratorContext<C, V>,
  ): void => {
    if (context.kind !== "accessor") {
      throw new TypeError("Протокол поддерживает только stage-3 accessor-поля (public accessor)");
    }
    if (context.private === true) {
      throw new TypeError("Приватные поля не поддерживаются протоколом");
    }
    if (context.static === true) {
      throw new TypeError("Статические поля не поддерживаются протоколом");
    }
    const field = String(context.name);
    const patch = options(field);
    context.addInitializer(function (this: object): void {
      registerFieldOption(this.constructor, field, patch);
    });
  };
}

function wireDecorator(wire: WireTypeName): ProtocolAccessorDecorator {
  return accessorDecorator(() => ({ wire }));
}

export function OneOf(value: number): ProtocolAccessorDecorator {
  if (!Number.isInteger(value) || value < 0 || value > 0x7fffffff) {
    throw new TypeError("OneOf требует целое значение в диапазоне uint32");
  }
  return accessorDecorator(() => ({ oneof: value }));
}

export function Int32(): ProtocolAccessorDecorator {
  return wireDecorator("int32");
}

export function Uint32(): ProtocolAccessorDecorator {
  return wireDecorator("uint32");
}

export function Int64(): ProtocolAccessorDecorator {
  return wireDecorator("int64");
}

export function Uint64(): ProtocolAccessorDecorator {
  return wireDecorator("uint64");
}

export function Float32(): ProtocolAccessorDecorator {
  return wireDecorator("float32");
}

export function Fixed32(): ProtocolAccessorDecorator {
  return wireDecorator("fixed32");
}

export function Fixed64(): ProtocolAccessorDecorator {
  return wireDecorator("fixed64");
}

export function EpochMillis(): ProtocolAccessorDecorator {
  return wireDecorator("epochMillis");
}
