use core::fmt;

/// Ошибка кодирования или декодирования протокола.
///
/// Метод [`ProtocolError::code`] возвращает стабильный строковый код для
/// логирования и межъязыковых проверок; текст `Display` предназначен для
/// человека и может меняться.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProtocolError {
    /// Входные данные закончились раньше, чем ожидалось.
    UnexpectedEof {
        /// Сколько байт требовалось.
        needed: usize,
        /// Сколько байт оставалось.
        remaining: usize,
    },
    /// Varint длиннее 10 байт или без завершающего байта.
    InvalidVarint,
    /// Значение не помещается в целевой целочисленный тип.
    IntegerOverflow,
    /// Недопустимый байт `bool`: не 0 и не 1.
    InvalidBool(u8),
    /// Строка не является корректным UTF-8.
    InvalidUtf8,
    /// После сообщения остались лишние байты.
    TrailingBytes(usize),
    /// Превышен лимит размера.
    SizeLimitExceeded {
        /// Действующий лимит в байтах.
        limit: usize,
    },
    /// Превышен лимит глубины вложенности.
    DepthLimitExceeded {
        /// Действующий лимит глубины.
        limit: u32,
    },
    /// Значение enum больше `2^31 - 1`.
    EnumOutOfRange {
        /// Недопустимое значение.
        value: u32,
    },
    /// Неизвестное значение enum при декодировании.
    UnknownEnumValue {
        /// Имя enum-типа.
        enum_name: &'static str,
        /// Неизвестное значение.
        value: u32,
    },
    /// Неизвестный вариант oneof при декодировании.
    UnknownOneOfVariant {
        /// Имя enum-дискриминатора.
        enum_name: &'static str,
        /// Неизвестное значение.
        value: u32,
    },
    /// В oneof установлено не ровно одно поле-вариант.
    OneOfCardinality {
        /// Имя enum-дискриминатора.
        enum_name: &'static str,
        /// Количество установленных вариантов.
        present: usize,
    },
    /// Установленный вариант oneof не соответствует дискриминатору.
    OneOfMismatch {
        /// Имя enum-дискриминатора.
        enum_name: &'static str,
        /// Имя поля-варианта.
        field: &'static str,
        /// Значение дискриминатора.
        value: u32,
    },
}

impl ProtocolError {
    /// Создаёт [`ProtocolError::UnexpectedEof`].
    pub fn eof(needed: usize, remaining: usize) -> Self {
        Self::UnexpectedEof { needed, remaining }
    }

    /// Создаёт [`ProtocolError::SizeLimitExceeded`].
    pub fn size_limit(limit: usize) -> Self {
        Self::SizeLimitExceeded { limit }
    }

    /// Создаёт [`ProtocolError::DepthLimitExceeded`].
    pub fn depth_limit(limit: u32) -> Self {
        Self::DepthLimitExceeded { limit }
    }

    /// Создаёт [`ProtocolError::UnknownEnumValue`].
    pub fn unknown_enum_value(enum_name: &'static str, value: u32) -> Self {
        Self::UnknownEnumValue { enum_name, value }
    }

    /// Создаёт [`ProtocolError::UnknownOneOfVariant`].
    pub fn unknown_oneof_variant(enum_name: &'static str, value: u32) -> Self {
        Self::UnknownOneOfVariant { enum_name, value }
    }

    /// Создаёт [`ProtocolError::OneOfCardinality`].
    pub fn oneof_cardinality(enum_name: &'static str, present: usize) -> Self {
        Self::OneOfCardinality { enum_name, present }
    }

    /// Создаёт [`ProtocolError::OneOfMismatch`].
    pub fn oneof_mismatch(enum_name: &'static str, field: &'static str, value: u32) -> Self {
        Self::OneOfMismatch {
            enum_name,
            field,
            value,
        }
    }

    /// Возвращает стабильный машиночитаемый код ошибки.
    ///
    /// Коды: `eof`, `varint`, `overflow`, `bool`, `utf8`, `trailing`,
    /// `limit.size`, `limit.depth`, `enum.range`, `enum.unknown`,
    /// `oneof.unknown`, `oneof.cardinality`, `oneof.mismatch`.
    pub fn code(&self) -> &'static str {
        match self {
            Self::UnexpectedEof { .. } => "eof",
            Self::InvalidVarint => "varint",
            Self::IntegerOverflow => "overflow",
            Self::InvalidBool(_) => "bool",
            Self::InvalidUtf8 => "utf8",
            Self::TrailingBytes(_) => "trailing",
            Self::SizeLimitExceeded { .. } => "limit.size",
            Self::DepthLimitExceeded { .. } => "limit.depth",
            Self::EnumOutOfRange { .. } => "enum.range",
            Self::UnknownEnumValue { .. } => "enum.unknown",
            Self::UnknownOneOfVariant { .. } => "oneof.unknown",
            Self::OneOfCardinality { .. } => "oneof.cardinality",
            Self::OneOfMismatch { .. } => "oneof.mismatch",
        }
    }
}

impl fmt::Display for ProtocolError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::UnexpectedEof { needed, remaining } => {
                write!(
                    f,
                    "unexpected end of input: needed {needed} byte(s), {remaining} remaining"
                )
            }
            Self::InvalidVarint => f.write_str("invalid varint encoding"),
            Self::IntegerOverflow => f.write_str("integer does not fit the target type"),
            Self::InvalidBool(value) => write!(f, "invalid bool byte {value}"),
            Self::InvalidUtf8 => f.write_str("invalid UTF-8 string"),
            Self::TrailingBytes(count) => write!(f, "{count} trailing byte(s) after message"),
            Self::SizeLimitExceeded { limit } => {
                write!(f, "size limit of {limit} byte(s) exceeded")
            }
            Self::DepthLimitExceeded { limit } => write!(f, "depth limit of {limit} exceeded"),
            Self::EnumOutOfRange { value } => write!(f, "enum value {value} is out of range"),
            Self::UnknownEnumValue { enum_name, value } => {
                write!(f, "unknown value {value} for enum {enum_name}")
            }
            Self::UnknownOneOfVariant { enum_name, value } => {
                write!(f, "unknown oneof variant {value} for enum {enum_name}")
            }
            Self::OneOfCardinality { enum_name, present } => {
                write!(
                    f,
                    "oneof {enum_name} must have exactly one variant, got {present}"
                )
            }
            Self::OneOfMismatch {
                enum_name,
                field,
                value,
            } => write!(
                f,
                "oneof {enum_name} variant {value} does not match field {field}"
            ),
        }
    }
}

impl std::error::Error for ProtocolError {}
