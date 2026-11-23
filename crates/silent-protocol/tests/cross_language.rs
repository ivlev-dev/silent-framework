use silent_protocol::SilentProto;
use std::collections::BTreeSet;

const HEX: &str = "01010cd09cd0bed181d0bad0b2d0b090aa0c3c80a0abfef9621075736572406578616d706c652e636f6d9693d89fee47044976616e020561646d696e047573657200000000000029400201610162";

#[derive(Debug, PartialEq, SilentProto)]
struct Address {
    city: String,
    zip: i32,
}

#[derive(Debug, PartialEq, SilentProto)]
struct User {
    active: bool,
    address: Address,
    age: i32,
    created_at: i64,
    email: Option<String>,
    id: i64,
    name: String,
    roles: BTreeSet<String>,
    score: f64,
    tags: Vec<String>,
}

fn sample() -> User {
    User {
        active: true,
        address: Address {
            city: "Москва".into(),
            zip: 101000,
        },
        age: 30,
        created_at: 1700000000000,
        email: Some("user@example.com".into()),
        id: 1234567890123,
        name: "Ivan".into(),
        roles: BTreeSet::from(["admin".to_string(), "user".to_string()]),
        score: 12.5,
        tags: vec!["a".into(), "b".into()],
    }
}

#[test]
fn matches_ts_and_kotlin() {
    let hex = sample()
        .encode()
        .unwrap()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    assert_eq!(hex, HEX);
    assert_eq!(User::decode(&hex_to_bytes(HEX)).unwrap(), sample());
}

fn hex_to_bytes(hex: &str) -> Vec<u8> {
    (0..hex.len())
        .step_by(2)
        .map(|index| u8::from_str_radix(&hex[index..index + 2], 16).unwrap())
        .collect()
}

#[derive(Debug, PartialEq, Eq, Clone, Copy, SilentProto)]
enum Kind {
    Created = 1,
    Updated = 2,
    Deleted = 3,
}

#[derive(Debug, PartialEq, SilentProto)]
struct Payload {
    count: i32,
    text: String,
}

#[derive(Debug, PartialEq, SilentProto)]
struct Event {
    kind: Kind,
    #[proto(oneof(Kind::Created))]
    created: Option<Payload>,
    #[proto(oneof(Kind::Updated))]
    updated: Option<i32>,
    #[proto(oneof(Kind::Deleted))]
    deleted: Option<()>,
}

#[test]
fn oneof_matches_ts_and_kotlin() {
    let created = Event {
        kind: Kind::Created,
        created: Some(Payload {
            count: 7,
            text: "hi".into(),
        }),
        updated: None,
        deleted: None,
    };
    assert_eq!(hex(&created), "010e026869");
    let updated = Event {
        kind: Kind::Updated,
        created: None,
        updated: Some(42),
        deleted: None,
    };
    assert_eq!(hex(&updated), "0254");
    let deleted = Event {
        kind: Kind::Deleted,
        created: None,
        updated: None,
        deleted: Some(()),
    };
    assert_eq!(hex(&deleted), "03");
}

fn hex(value: &Event) -> String {
    value
        .encode()
        .unwrap()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}
