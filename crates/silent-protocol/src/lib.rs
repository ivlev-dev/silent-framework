//! Бинарный протокол Silent для Rust.
//!
//! Крейт предоставляет derive-макрос [`SilentProto`], низкоуровневые [`Encoder`]
//! и [`Decoder`], лимиты [`Limits`], ошибки [`ProtocolError`] и описание схемы
//! ([`SchemaEntry`], [`SchemaType`], [`canonical`], [`fingerprint`]).
//!
//! Формат не содержит имён полей и тегов: схема задаётся структурой Rust.
//! Поля кодируются в порядке сортировки имён (по возрастанию UTF-8 байт),
//! `Option<T>` выносится в bitmap присутствия, вложенные сообщения пишутся
//! без префикса длины. Один и тот же wire-формат используется в TS, Rust и
//! Kotlin, поэтому бинарные векторы совместимы между языками.
//!
//! # Быстрый старт
//!
//! ```
//! use silent_protocol::SilentProto;
//!
//! #[derive(Debug, PartialEq, SilentProto)]
//! struct User {
//!     name: String,
//!     age: u32,
//!     email: Option<String>,
//! }
//!
//! let user = User {
//!     name: "Иван".into(),
//!     age: 30,
//!     email: None,
//! };
//!
//! let bytes = user.encode().unwrap();
//! let restored = User::decode(&bytes).unwrap();
//! assert_eq!(restored, user);
//! ```
//!
//! # Wire-формат
//!
//! Сообщение кодируется как `[bitmap?][значения полей в порядке схемы]`.
//! Bitmap длиной `ceil(optional_count / 8)` байт присутствует, только если в
//! сообщении есть `Option<T>`-поля; бит `i` (LSB-first) соответствует `i`-му
//! optional-полю в порядке сортировки имён. Если optional-полей нет, bitmap
//! отсутствует. Вложенное сообщение имеет собственный bitmap в начале payload.
//!
//! Примитивы: `bool` — 1 байт, `i32`/`i64` — zigzag varint, `u32`/`u64` —
//! varint, `fixed32`/`fixed64` — little-endian, `f32`/`f64` — IEEE 754
//! little-endian, `String` и `Vec<u8>`/`Bytes` — varint длины и байты.
//! Массивы и множества — varint количества и элементы; `Vec<Option<T>>`
//! дополнительно содержит bitmap элементов. `BTreeMap` кодируется в
//! каноническом порядке ключей. oneof — varint значения enum и payload
//! выбранного варианта.
//!
//! # Ограничения
//!
//! - Нет tuple, кортежных структур, литералов схемы, fixed-size массивов,
//!   ссылок, умных указателей и generic-типов.
//! - `Vec<u8>` трактуется как `bytes`, а не как массив чисел.
//! - Enum вне oneof требует атрибута `#[proto(enum_type)]` на поле и
//!   реализует [`ProtoEnum`] через `#[derive(SilentProto)]`.
//! - `Option<Option<T>>` не поддерживается.
//! - Поддерживается несколько oneof-групп, если у каждой свой enum-дискриминатор;
//!   одно поле может входить только в одну группу.

extern crate self as silent_protocol;

mod decoder;
mod encoder;
mod error;
mod schema;

pub use decoder::{Bitmap, Decoder};
pub use encoder::Encoder;
pub use error::ProtocolError;
pub use schema::{
    canonical, fingerprint, SchemaEntry, SchemaField, SchemaOneOf, SchemaType, SchemaVariant,
};
pub use silent_protocol_macros::SilentProto;

/// Лимиты кодирования и декодирования.
///
/// `max_depth` ограничивает глубину вложенности сообщений, `max_size` —
/// суммарный размер буфера в байтах (для [`Encoder`] — записанных с момента
/// создания, для [`Decoder`] — объявленных длин строк, bytes и коллекций).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Limits {
    /// Максимальная глубина вложенных сообщений.
    pub max_depth: u32,
    /// Максимальный размер в байтах.
    pub max_size: usize,
}

impl Limits {
    /// Значение `max_depth` по умолчанию — 256.
    pub const DEFAULT_MAX_DEPTH: u32 = 256;
    /// Значение `max_size` по умолчанию — 64 MiB.
    pub const DEFAULT_MAX_SIZE: usize = 64 * 1024 * 1024;

    /// Создаёт лимиты с явными значениями.
    pub const fn new(max_depth: u32, max_size: usize) -> Self {
        Self {
            max_depth,
            max_size,
        }
    }
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            max_depth: Self::DEFAULT_MAX_DEPTH,
            max_size: Self::DEFAULT_MAX_SIZE,
        }
    }
}

/// Числовой enum протокола.
///
/// Реализуется `#[derive(SilentProto)]` для enum-типов: вариант получает
/// varint-код из дискриминанта (неявные дискриминанты нумеруются с нуля).
/// Значения должны быть неотрицательными и не превышать `2^31 - 1`.
/// Используется для oneof-дискриминаторов и для полей с `#[proto(enum_type)]`.
pub trait ProtoEnum: Copy + Sized {
    /// Имя enum-типа, попадающее в схему и ошибки.
    const NAME: &'static str;

    /// Возвращает wire-значение варианта.
    fn to_proto(self) -> u32;

    /// Восстанавливает вариант из wire-значения.
    ///
    /// Возвращает [`ProtocolError::UnknownEnumValue`] для неизвестного кода.
    fn from_proto(value: u32) -> Result<Self, ProtocolError>;
}

/// Тип, который можно закодировать и декодировать протоколом.
///
/// Обычно реализуется через `#[derive(SilentProto)]`; вручную реализуются
/// только [`write`](SilentProto::write), [`read`](SilentProto::read) и
/// [`schema`](SilentProto::schema).
pub trait SilentProto: Sized {
    /// Записывает значение в кодировщик.
    fn write(&self, encoder: &mut Encoder<'_>) -> Result<(), ProtocolError>;

    /// Читает значение из декодера.
    fn read(decoder: &mut Decoder<'_>) -> Result<Self, ProtocolError>;

    /// Возвращает описание схемы: поля и oneof-группы в порядке кодирования.
    fn schema() -> Vec<SchemaEntry>;

    /// Возвращает 64-битный отпечаток схемы.
    fn schema_hash() -> u64 {
        fingerprint(&Self::schema())
    }

    /// Кодирует значение в новый буфер.
    fn encode(&self) -> Result<Vec<u8>, ProtocolError> {
        let mut out = Vec::new();
        self.encode_to(&mut out)?;
        Ok(out)
    }

    /// Дописывает значение в конец буфера с лимитами по умолчанию.
    fn encode_to(&self, out: &mut Vec<u8>) -> Result<(), ProtocolError> {
        self.encode_to_with_limits(out, Limits::default())
    }

    /// Дописывает значение в конец буфера с заданными лимитами.
    fn encode_to_with_limits(
        &self,
        out: &mut Vec<u8>,
        limits: Limits,
    ) -> Result<(), ProtocolError> {
        let mut encoder = Encoder::with_limits(out, limits);
        encoder.write_message(self)
    }

    /// Декодирует значение из буфера и проверяет отсутствие лишних байтов.
    fn decode(bytes: &[u8]) -> Result<Self, ProtocolError> {
        Self::decode_with_limits(bytes, Limits::default())
    }

    /// Декодирует значение с заданными лимитами и проверяет отсутствие
    /// лишних байтов.
    fn decode_with_limits(bytes: &[u8], limits: Limits) -> Result<Self, ProtocolError> {
        let mut decoder = Decoder::with_limits(bytes, limits);
        let value = decoder.read_message::<Self>()?;
        decoder.finish()?;
        Ok(value)
    }

    /// Читает значение из общего декодера, не проверяя остаток буфера.
    fn decode_from(decoder: &mut Decoder<'_>) -> Result<Self, ProtocolError> {
        decoder.read_message::<Self>()
    }
}
