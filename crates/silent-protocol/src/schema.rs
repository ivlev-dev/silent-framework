/// Тип поля или варианта в описании схемы.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SchemaType {
    /// `bool`: один байт 0/1.
    Bool,
    /// `i32`: zigzag varint.
    Int32,
    /// `u32`: varint.
    Uint32,
    /// `i64`: zigzag varint.
    Int64,
    /// `u64`: varint.
    Uint64,
    /// `f32`: IEEE 754, 4 байта little-endian.
    Float32,
    /// `f64`: IEEE 754, 8 байт little-endian.
    Float64,
    /// `u32` фиксированной ширины, 4 байта little-endian.
    Fixed32,
    /// `u64` фиксированной ширины, 8 байт little-endian.
    Fixed64,
    /// UTF-8 строка с varint-длиной.
    String,
    /// Сырые байты с varint-длиной.
    Bytes,
    /// Дата в epoch milliseconds (`i64` zigzag varint).
    Date,
    /// Единичное значение без payload.
    Unit,
    /// Enum-тип с указанным именем.
    Enum(&'static str),
    /// Вложенное сообщение с указанным именем типа.
    Message(&'static str),
    /// Массив элементов.
    Array(Box<SchemaType>),
    /// Map с типами ключа и значения.
    Map(Box<SchemaType>, Box<SchemaType>),
    /// Множество элементов.
    Set(Box<SchemaType>),
    /// Optional-значение, вынесенное в bitmap.
    Optional(Box<SchemaType>),
}

/// Поле сообщения в описании схемы.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SchemaField {
    /// Имя поля протокола (с учётом `#[proto(rename)]`).
    pub name: &'static str,
    /// Тип поля без внешнего `Optional`.
    pub ty: SchemaType,
    /// Признак optional-поля (бит в bitmap).
    pub optional: bool,
}

/// Вариант oneof-группы.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SchemaVariant {
    /// Wire-значение enum-дискриминатора.
    pub value: u32,
    /// Имя поля-варианта.
    pub field: &'static str,
    /// Тип payload варианта.
    pub ty: SchemaType,
}

/// oneof-группа в описании схемы.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SchemaOneOf {
    /// Имя поля-дискриминатора (позиция группы в сообщении).
    pub name: &'static str,
    /// Имя enum-типа дискриминатора.
    pub enum_name: &'static str,
    /// Варианты, отсортированные по wire-значению.
    pub variants: Vec<SchemaVariant>,
}

/// Элемент описания сообщения: обычное поле или oneof-группа.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SchemaEntry {
    /// Обычное поле.
    Field(SchemaField),
    /// oneof-группа, занимающая позицию поля-дискриминатора.
    OneOf(SchemaOneOf),
}

impl SchemaEntry {
    /// Возвращает имя поля или oneof-группы.
    pub fn name(&self) -> &'static str {
        match self {
            Self::Field(field) => field.name,
            Self::OneOf(oneof) => oneof.name,
        }
    }
}

fn render_type(ty: &SchemaType, out: &mut String) {
    match ty {
        SchemaType::Bool => out.push_str("bool"),
        SchemaType::Int32 => out.push_str("int32"),
        SchemaType::Uint32 => out.push_str("uint32"),
        SchemaType::Int64 => out.push_str("int64"),
        SchemaType::Uint64 => out.push_str("uint64"),
        SchemaType::Float32 => out.push_str("float32"),
        SchemaType::Float64 => out.push_str("float64"),
        SchemaType::Fixed32 => out.push_str("fixed32"),
        SchemaType::Fixed64 => out.push_str("fixed64"),
        SchemaType::String => out.push_str("string"),
        SchemaType::Bytes => out.push_str("bytes"),
        SchemaType::Date => out.push_str("date"),
        SchemaType::Unit => out.push_str("unit"),
        SchemaType::Enum(name) => {
            out.push_str("enum(");
            out.push_str(name);
            out.push(')');
        }
        SchemaType::Message(name) => {
            out.push_str("message(");
            out.push_str(name);
            out.push(')');
        }
        SchemaType::Array(inner) => {
            out.push_str("array(");
            render_type(inner, out);
            out.push(')');
        }
        SchemaType::Map(key, value) => {
            out.push_str("map(");
            render_type(key, out);
            out.push(',');
            render_type(value, out);
            out.push(')');
        }
        SchemaType::Set(inner) => {
            out.push_str("set(");
            render_type(inner, out);
            out.push(')');
        }
        SchemaType::Optional(inner) => {
            out.push_str("optional(");
            render_type(inner, out);
            out.push(')');
        }
    }
}

/// Возвращает каноническое текстовое представление схемы.
///
/// Формат строк стабилен и используется для отпечатка: поля идут как
/// `field|<имя>|<тип>|<0|1>`, oneof — как
/// `oneof|<имя>|<enum>|<value>:<поле>:<тип>...` с вариантами по возрастанию
/// значения. Каждая строка завершается `\n`.
///
/// ```
/// use silent_protocol::{canonical, SchemaEntry, SchemaField, SchemaType};
///
/// let entries = vec![SchemaEntry::Field(SchemaField {
///     name: "id",
///     ty: SchemaType::Int64,
///     optional: false,
/// })];
/// assert_eq!(canonical(&entries), "field|id|int64|0\n");
/// ```
pub fn canonical(entries: &[SchemaEntry]) -> String {
    let mut out = String::new();
    for entry in entries {
        match entry {
            SchemaEntry::Field(field) => {
                out.push_str("field|");
                out.push_str(field.name);
                out.push('|');
                render_type(&field.ty, &mut out);
                out.push('|');
                out.push_str(if field.optional { "1" } else { "0" });
            }
            SchemaEntry::OneOf(oneof) => {
                out.push_str("oneof|");
                out.push_str(oneof.name);
                out.push('|');
                out.push_str(oneof.enum_name);
                let mut variants = oneof.variants.clone();
                variants.sort_by_key(|variant| variant.value);
                for variant in variants {
                    out.push('|');
                    out.push_str(&variant.value.to_string());
                    out.push(':');
                    out.push_str(variant.field);
                    out.push(':');
                    render_type(&variant.ty, &mut out);
                }
            }
        }
        out.push('\n');
    }
    out
}

/// Возвращает 64-битный отпечаток схемы (FNV-1a по [`canonical`]).
///
/// Отпечаток детерминирован для одинаковых имён полей и типов и не зависит
/// от имени Rust-структуры. Формат отпечатка отличается от TS и Kotlin;
/// для межъязыковой совместимости используйте бинарные векторы.
pub fn fingerprint(entries: &[SchemaEntry]) -> u64 {
    let mut hash = 0xcbf2_9ce4_8422_2325u64;
    for byte in canonical(entries).bytes() {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}
