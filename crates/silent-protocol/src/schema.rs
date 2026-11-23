#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SchemaType {
    Bool,
    Int32,
    Uint32,
    Int64,
    Uint64,
    Float32,
    Float64,
    Fixed32,
    Fixed64,
    String,
    Bytes,
    Date,
    Unit,
    Enum(&'static str),
    Message(&'static str),
    Array(Box<SchemaType>),
    Map(Box<SchemaType>, Box<SchemaType>),
    Set(Box<SchemaType>),
    Optional(Box<SchemaType>),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SchemaField {
    pub name: &'static str,
    pub ty: SchemaType,
    pub optional: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SchemaVariant {
    pub value: u32,
    pub field: &'static str,
    pub ty: SchemaType,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SchemaOneOf {
    pub name: &'static str,
    pub enum_name: &'static str,
    pub variants: Vec<SchemaVariant>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SchemaEntry {
    Field(SchemaField),
    OneOf(SchemaOneOf),
}

impl SchemaEntry {
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

pub fn fingerprint(entries: &[SchemaEntry]) -> u64 {
    let mut hash = 0xcbf2_9ce4_8422_2325u64;
    for byte in canonical(entries).bytes() {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}
