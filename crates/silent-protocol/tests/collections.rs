mod common;

use std::collections::{BTreeMap, BTreeSet};

use common::{encode, roundtrip};
use silent_protocol::SilentProto;

#[derive(Debug, PartialEq, Eq, PartialOrd, Ord, SilentProto)]
struct Item {
    x: u32,
}

#[derive(Debug, PartialEq, SilentProto)]
struct IntSet {
    value: BTreeSet<u32>,
}

#[derive(Debug, PartialEq, SilentProto)]
struct StringSet {
    value: BTreeSet<String>,
}

#[derive(Debug, PartialEq, SilentProto)]
struct IntMap {
    value: BTreeMap<u32, String>,
}

#[derive(Debug, PartialEq, SilentProto)]
struct StringMap {
    value: BTreeMap<String, u32>,
}

#[derive(Debug, PartialEq, SilentProto)]
struct BoolMap {
    value: BTreeMap<bool, u32>,
}

#[derive(Debug, PartialEq, SilentProto)]
struct OptionalValueMap {
    value: BTreeMap<String, Option<u32>>,
}

#[derive(Debug, PartialEq, SilentProto)]
struct MessageValueMap {
    value: BTreeMap<String, Item>,
}

#[derive(Debug, PartialEq, SilentProto)]
struct MessageSet {
    value: BTreeSet<Item>,
}

#[derive(Debug, PartialEq, SilentProto)]
struct NestedCollections {
    value: Vec<BTreeMap<String, Vec<u32>>>,
}

#[test]
fn set_is_canonical() {
    let value = IntSet {
        value: [3u32, 1, 2].into_iter().collect(),
    };
    assert_eq!(encode(&value), vec![3, 1, 2, 3]);
    roundtrip(&value);
    roundtrip(&IntSet {
        value: BTreeSet::new(),
    });
    assert_eq!(
        encode(&IntSet {
            value: BTreeSet::new()
        }),
        vec![0]
    );
}

#[test]
fn string_set_sorted_by_utf8() {
    let value = StringSet {
        value: ["b".to_string(), "a".to_string(), "ä".to_string()]
            .into_iter()
            .collect(),
    };
    let bytes = encode(&value);
    assert_eq!(bytes[0], 3);
    roundtrip(&value);
}

#[test]
fn map_sorted_by_key() {
    let value = StringMap {
        value: [("b".to_string(), 2u32), ("a".to_string(), 1u32)]
            .into_iter()
            .collect(),
    };
    assert_eq!(encode(&value), vec![2, 1, b'a', 1, 1, b'b', 2]);
    roundtrip(&value);
    assert_eq!(
        encode(&StringMap {
            value: BTreeMap::new()
        }),
        vec![0]
    );
}

#[test]
fn int_key_map() {
    let value = IntMap {
        value: [(2u32, "b".to_string()), (1u32, "a".to_string())]
            .into_iter()
            .collect(),
    };
    assert_eq!(encode(&value), vec![2, 1, 1, b'a', 2, 1, b'b']);
    roundtrip(&value);
}

#[test]
fn bool_key_map() {
    let value = BoolMap {
        value: [(true, 2u32), (false, 1u32)].into_iter().collect(),
    };
    assert_eq!(encode(&value), vec![2, 0, 1, 1, 2]);
    roundtrip(&value);
}

#[test]
fn optional_map_values() {
    let value = OptionalValueMap {
        value: [
            ("a".to_string(), Some(1u32)),
            ("b".to_string(), None),
            ("c".to_string(), Some(3u32)),
        ]
        .into_iter()
        .collect(),
    };
    assert_eq!(encode(&value), vec![3, 5, 1, b'a', 1, 1, b'b', 1, b'c', 3]);
    roundtrip(&value);
    let none = OptionalValueMap {
        value: [("a".to_string(), None)].into_iter().collect(),
    };
    assert_eq!(encode(&none), vec![1, 0, 1, b'a']);
    roundtrip(&none);
}

#[test]
fn message_map_values() {
    let value = MessageValueMap {
        value: [("k".to_string(), Item { x: 5 })].into_iter().collect(),
    };
    assert_eq!(encode(&value), vec![1, 1, b'k', 5]);
    roundtrip(&value);
}

#[test]
fn message_set() {
    let value = MessageSet {
        value: [Item { x: 2 }, Item { x: 1 }].into_iter().collect(),
    };
    assert_eq!(encode(&value), vec![2, 1, 2]);
    roundtrip(&value);
}

#[test]
fn nested_collections() {
    let value = NestedCollections {
        value: vec![
            [("a".to_string(), vec![1u32, 2])].into_iter().collect(),
            BTreeMap::new(),
        ],
    };
    roundtrip(&value);
}

#[derive(Debug, PartialEq, SilentProto)]
struct Matrix {
    value: Vec<Vec<u32>>,
}

#[test]
fn nested_arrays() {
    let value = Matrix {
        value: vec![vec![1, 2], vec![], vec![3]],
    };
    assert_eq!(encode(&value), vec![3, 2, 1, 2, 0, 1, 3]);
    roundtrip(&value);
}

#[test]
fn oversized_collection_count() {
    let error = IntSet::decode(&[0xFF, 0xFF, 0xFF, 0xFF, 0x7F]).unwrap_err();
    assert_eq!(error.code(), "limit.size");
}
