mod common;

use std::collections::HashMap;

use common::{decode, encode, roundtrip};
use silent_protocol::{SchemaEntry, SilentProto};

#[derive(Debug, PartialEq, SilentProto)]
struct Skipped {
    value: u32,
    #[proto(skip)]
    cache: HashMap<String, String>,
    #[proto(skip)]
    marker: Option<u8>,
}

#[test]
fn skip_field_is_not_encoded() {
    let mut cache = HashMap::new();
    cache.insert("k".to_string(), "v".to_string());
    let value = Skipped {
        value: 7,
        cache,
        marker: Some(3),
    };
    assert_eq!(encode(&value), vec![7]);
    let decoded: Skipped = decode(&[7]);
    assert_eq!(decoded.value, 7);
    assert!(decoded.cache.is_empty());
    assert_eq!(decoded.marker, None);
    roundtrip(&Skipped {
        value: 1,
        cache: HashMap::new(),
        marker: None,
    });
}

#[test]
fn skip_field_excluded_from_schema() {
    let names: Vec<&str> = Skipped::schema()
        .iter()
        .map(SchemaEntry::name)
        .collect::<Vec<_>>();
    assert_eq!(names, vec!["value"]);
}

#[derive(Debug, PartialEq, SilentProto)]
struct OptionalSkip {
    a: Option<u32>,
    #[proto(skip)]
    b: u8,
}

#[test]
fn skip_field_does_not_affect_bitmap() {
    assert_eq!(encode(&OptionalSkip { a: None, b: 9 }), vec![0]);
    assert_eq!(encode(&OptionalSkip { a: Some(1), b: 9 }), vec![1, 1]);
    let decoded: OptionalSkip = decode(&[0]);
    assert_eq!(decoded, OptionalSkip { a: None, b: 0 });
}
