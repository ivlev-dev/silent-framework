# silent-protocol-macros

Proc-macro-крейт для [`silent-protocol`](https://github.com/ivlev-dev/silent-framework/tree/main/crates/silent-protocol).
Содержит только `#[derive(SilentProto)]`; подключать этот крейт напрямую не
нужно — макрос реэкспортируется как `silent_protocol::SilentProto`.

```toml
[dependencies]
silent-protocol = "0.14"
```

## Что генерируется

- Для структуры с именованными полями — реализация `SilentProto`: `write`,
  `read`, `schema`. Поля сортируются по имени (UTF-8), `Option<T>` выносится
  в bitmap присутствия.
- Для enum из unit-вариантов — реализация `ProtoEnum` (`NAME`, `to_proto`,
  `from_proto`). Неотрицательные дискриминанты не больше `2^31 - 1`,
  дубликаты запрещены.

Не поддерживаются: generic-типы, tuple-структуры, unit-структуры, union,
tuple/fixed-size массивы, ссылки и умные указатели.

## Атрибуты `#[proto(...)]`

| Атрибут | Где | Действие |
| --- | --- | --- |
| `int32`, `uint32`, `int64`, `uint64`, `float32`, `fixed32`, `fixed64` | поле | Явный wire-тип с проверкой Rust-типа |
| `date` | поле `i64` | Тип `date` в схеме (epoch ms, zigzag varint) |
| `enum_type` | поле enum | Разрешает enum вне oneof |
| `oneof(Enum::Variant)` | `Option<T>` поле | Включает поле в oneof-группу |
| `rename = "name"` | поле | Имя в схеме, влияет на сортировку и bitmap |
| `skip` | поле | Исключает поле из wire и схемы |

Несколько атрибутов объединяются через запятую. `skip` не сочетается с
другими атрибутами; oneof-поле не может иметь явный wire-тип или
`enum_type`.

## Пример

```rust
use silent_protocol::SilentProto;

#[derive(Debug, PartialEq, Eq, Clone, Copy, SilentProto)]
enum Kind {
    Created = 1,
    Deleted = 2,
}

#[derive(Debug, PartialEq, SilentProto)]
struct Event {
    kind: Kind,
    #[proto(oneof(Kind::Created))]
    created: Option<String>,
    #[proto(oneof(Kind::Deleted))]
    deleted: Option<()>,
}
```

Полная документация формата, типов, лимитов и ошибок — в README и rustdoc
крейта `silent-protocol`.

## Проверка

```bash
cargo test -p silent-protocol
cargo clippy -p silent-protocol-macros --all-targets -- -D warnings
```

## Лицензия

MIT.
