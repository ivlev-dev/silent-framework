use core::fmt;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProtocolError {
    UnexpectedEof {
        needed: usize,
        remaining: usize,
    },
    InvalidVarint,
    IntegerOverflow,
    InvalidBool(u8),
    InvalidUtf8,
    TrailingBytes(usize),
    SizeLimitExceeded {
        limit: usize,
    },
    DepthLimitExceeded {
        limit: u32,
    },
    EnumOutOfRange {
        value: u32,
    },
    UnknownEnumValue {
        enum_name: &'static str,
        value: u32,
    },
    UnknownOneOfVariant {
        enum_name: &'static str,
        value: u32,
    },
    OneOfCardinality {
        enum_name: &'static str,
        present: usize,
    },
    OneOfMismatch {
        enum_name: &'static str,
        field: &'static str,
        value: u32,
    },
}

impl ProtocolError {
    pub fn eof(needed: usize, remaining: usize) -> Self {
        Self::UnexpectedEof { needed, remaining }
    }

    pub fn size_limit(limit: usize) -> Self {
        Self::SizeLimitExceeded { limit }
    }

    pub fn depth_limit(limit: u32) -> Self {
        Self::DepthLimitExceeded { limit }
    }

    pub fn unknown_enum_value(enum_name: &'static str, value: u32) -> Self {
        Self::UnknownEnumValue { enum_name, value }
    }

    pub fn unknown_oneof_variant(enum_name: &'static str, value: u32) -> Self {
        Self::UnknownOneOfVariant { enum_name, value }
    }

    pub fn oneof_cardinality(enum_name: &'static str, present: usize) -> Self {
        Self::OneOfCardinality { enum_name, present }
    }

    pub fn oneof_mismatch(enum_name: &'static str, field: &'static str, value: u32) -> Self {
        Self::OneOfMismatch {
            enum_name,
            field,
            value,
        }
    }

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
