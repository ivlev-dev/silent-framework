mod common;

use std::collections::{BTreeMap, BTreeSet};

use silent_protocol::{canonical, fingerprint, SchemaEntry, SchemaType, SilentProto};

#[derive(Debug, PartialEq, Eq, Clone, Copy, SilentProto)]
enum Op {
    High = 9,
    Low = 1,
}

#[derive(Debug, PartialEq, SilentProto)]
struct SchemaSample {
    zeta: u32,
    alpha: Option<String>,
    beta: Vec<Option<u32>>,
    gamma: BTreeMap<String, Vec<u8>>,
    delta: BTreeSet<u64>,
    op: Op,
    #[proto(oneof(Op::High))]
    high: Option<()>,
    #[proto(oneof(Op::Low))]
    low: Option<u32>,
}

#[derive(Debug, PartialEq, SilentProto)]
struct RenameA {
    a: Option<u32>,
    b: u32,
}

#[derive(Debug, PartialEq, SilentProto)]
struct RenameB {
    #[proto(rename = "z")]
    a: Option<u32>,
    b: u32,
}

#[derive(Debug, PartialEq, SilentProto)]
struct SameOne {
    value: u32,
}

#[derive(Debug, PartialEq, SilentProto)]
struct SameTwo {
    value: u32,
}

#[derive(Debug, PartialEq, SilentProto)]
struct Typed {
    #[proto(date)]
    created: i64,
    #[proto(fixed32)]
    fixed: u32,
    #[proto(uint64)]
    big: u64,
    raw: Vec<u8>,
}

#[test]
fn schema_entries_are_sorted_and_typed() {
    let names: Vec<&str> = SchemaSample::schema()
        .iter()
        .map(SchemaEntry::name)
        .collect::<Vec<_>>();
    assert_eq!(names, vec!["alpha", "beta", "delta", "gamma", "op", "zeta"]);

    let expected = "field|alpha|string|1\n\
field|beta|array(optional(uint32))|0\n\
field|delta|set(uint64)|0\n\
field|gamma|map(string,bytes)|0\n\
oneof|op|Op|1:low:uint32|9:high:unit\n\
field|zeta|uint32|0\n";
    assert_eq!(canonical(&SchemaSample::schema()), expected);
}

#[test]
fn oneof_variants_sorted_by_value() {
    let oneof = SchemaSample::schema()
        .into_iter()
        .find_map(|entry| match entry {
            SchemaEntry::OneOf(oneof) => Some(oneof),
            SchemaEntry::Field(_) => None,
        })
        .unwrap();
    let values: Vec<u32> = oneof.variants.iter().map(|variant| variant.value).collect();
    assert_eq!(values, vec![1, 9]);
    assert_eq!(oneof.variants[0].field, "low");
}

#[test]
fn schema_hash_is_deterministic() {
    assert_eq!(SchemaSample::schema_hash(), SchemaSample::schema_hash());
    assert_eq!(
        SchemaSample::schema_hash(),
        fingerprint(&SchemaSample::schema())
    );
    assert_ne!(SchemaSample::schema_hash(), 0);
}

#[test]
fn schema_hash_ignores_type_name_but_respects_names() {
    assert_eq!(SameOne::schema_hash(), SameTwo::schema_hash());
    assert_ne!(RenameA::schema_hash(), RenameB::schema_hash());
}

#[test]
fn schema_types_for_wire_attributes() {
    let entries = Typed::schema();
    let types: Vec<SchemaType> = entries
        .iter()
        .filter_map(|entry| match entry {
            SchemaEntry::Field(field) => Some(field.ty.clone()),
            SchemaEntry::OneOf(_) => None,
        })
        .collect();
    assert!(types.contains(&SchemaType::Date));
    assert!(types.contains(&SchemaType::Fixed32));
    assert!(types.contains(&SchemaType::Uint64));
    assert!(types.contains(&SchemaType::Bytes));
}
