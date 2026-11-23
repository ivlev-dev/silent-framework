mod common;

use common::{decode, encode, roundtrip};
use silent_protocol::{ProtoEnum, SilentProto};

#[derive(Debug, PartialEq, Eq, Clone, Copy, SilentProto)]
enum Kind {
    A = 1,
    B = 2,
    C = 3,
    D = 4,
}

#[derive(Debug, PartialEq, Eq, Clone, Copy, SilentProto)]
enum Other {
    X = 10,
    Y = 20,
}

#[derive(Debug, PartialEq, Eq, Clone, Copy, SilentProto)]
enum Implicit {
    Zero,
    One,
    Two,
}

#[derive(Debug, PartialEq, SilentProto)]
struct Payload {
    n: u32,
}

#[derive(Debug, PartialEq, SilentProto)]
struct Event {
    kind: Kind,
    #[proto(oneof(Kind::A))]
    a: Option<Payload>,
    #[proto(oneof(Kind::B))]
    b: Option<Vec<u32>>,
    #[proto(oneof(Kind::C))]
    c: Option<()>,
}

#[test]
fn payload_variant() {
    let value = Event {
        kind: Kind::A,
        a: Some(Payload { n: 5 }),
        b: None,
        c: None,
    };
    assert_eq!(encode(&value), vec![1, 5]);
    roundtrip(&value);
}

#[test]
fn array_variant() {
    let value = Event {
        kind: Kind::B,
        a: None,
        b: Some(vec![1, 2]),
        c: None,
    };
    assert_eq!(encode(&value), vec![2, 2, 1, 2]);
    roundtrip(&value);
}

#[test]
fn unit_variant() {
    let value = Event {
        kind: Kind::C,
        a: None,
        b: None,
        c: Some(()),
    };
    assert_eq!(encode(&value), vec![3]);
    roundtrip(&value);
}

#[test]
fn missing_variant() {
    let value = Event {
        kind: Kind::A,
        a: None,
        b: None,
        c: None,
    };
    assert_eq!(value.encode().unwrap_err().code(), "oneof.cardinality");
}

#[test]
fn conflicting_variants() {
    let value = Event {
        kind: Kind::A,
        a: Some(Payload { n: 1 }),
        b: Some(vec![]),
        c: None,
    };
    assert_eq!(value.encode().unwrap_err().code(), "oneof.cardinality");
}

#[test]
fn discriminator_mismatch() {
    let value = Event {
        kind: Kind::A,
        a: None,
        b: Some(vec![1]),
        c: None,
    };
    assert_eq!(value.encode().unwrap_err().code(), "oneof.mismatch");
}

#[test]
fn unknown_oneof_variant() {
    let error = Event::decode(&[4]).unwrap_err();
    assert_eq!(error.code(), "oneof.unknown");
}

#[test]
fn unknown_enum_variant() {
    let error = Event::decode(&[9]).unwrap_err();
    assert_eq!(error.code(), "enum.unknown");
}

#[derive(Debug, PartialEq, SilentProto)]
struct Multi {
    first: Kind,
    second: Other,
    #[proto(oneof(Kind::A))]
    a: Option<Payload>,
    #[proto(oneof(Kind::B))]
    b: Option<Vec<u32>>,
    #[proto(oneof(Kind::C))]
    c: Option<()>,
    #[proto(oneof(Other::X))]
    x: Option<()>,
    #[proto(oneof(Other::Y))]
    y: Option<String>,
}

#[test]
fn multiple_oneofs() {
    let value = Multi {
        first: Kind::A,
        second: Other::X,
        a: Some(Payload { n: 5 }),
        b: None,
        c: None,
        x: Some(()),
        y: None,
    };
    assert_eq!(encode(&value), vec![1, 5, 10]);
    roundtrip(&value);

    let value = Multi {
        first: Kind::C,
        second: Other::Y,
        a: None,
        b: None,
        c: Some(()),
        x: None,
        y: Some("hi".into()),
    };
    assert_eq!(encode(&value), vec![3, 20, 2, b'h', b'i']);
    roundtrip(&value);
}

#[test]
fn oneof_position_follows_discriminator_name() {
    #[derive(Debug, PartialEq, SilentProto)]
    struct Reordered {
        #[proto(rename = "a")]
        kind: Kind,
        #[proto(oneof(Kind::A))]
        payload: Option<Payload>,
        z: u32,
    }
    let value = Reordered {
        kind: Kind::A,
        payload: Some(Payload { n: 7 }),
        z: 1,
    };
    assert_eq!(encode(&value), vec![1, 7, 1]);
    let decoded: Reordered = decode(&[1, 7, 1]);
    assert_eq!(decoded, value);
}

#[derive(Debug, PartialEq, SilentProto)]
struct EnumField {
    #[proto(enum_type)]
    kind: Kind,
    note: String,
}

#[test]
fn enum_field_outside_oneof() {
    let value = EnumField {
        kind: Kind::D,
        note: "x".into(),
    };
    assert_eq!(encode(&value), vec![4, 1, b'x']);
    roundtrip(&value);
}

#[derive(Debug, PartialEq, SilentProto)]
struct ExplicitEnumField {
    #[proto(enum_type)]
    kind: Implicit,
    value: u32,
}

#[test]
fn enum_values_and_implicit_discriminants() {
    assert_eq!(Implicit::Zero.to_proto(), 0);
    assert_eq!(Implicit::One.to_proto(), 1);
    assert_eq!(Implicit::Two.to_proto(), 2);
    assert_eq!(Implicit::from_proto(2).unwrap(), Implicit::Two);
    assert_eq!(Implicit::from_proto(7).unwrap_err().code(), "enum.unknown");

    let value = ExplicitEnumField {
        kind: Implicit::Two,
        value: 0,
    };
    assert_eq!(encode(&value), vec![2, 0]);
    roundtrip(&value);
}

#[test]
fn oneof_variant_name_is_rename() {
    let schema = Event::schema();
    let oneof = schema
        .iter()
        .find_map(|entry| match entry {
            silent_protocol::SchemaEntry::OneOf(oneof) => Some(oneof),
            silent_protocol::SchemaEntry::Field(_) => None,
        })
        .unwrap();
    assert_eq!(oneof.enum_name, "Kind");
    assert_eq!(oneof.name, "kind");
    let values: Vec<u32> = oneof.variants.iter().map(|variant| variant.value).collect();
    assert_eq!(values, vec![1, 2, 3]);
    assert_eq!(oneof.variants[0].field, "a");
}
