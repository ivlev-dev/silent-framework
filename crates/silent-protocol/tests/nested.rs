mod common;

use common::{decode, encode, roundtrip};
use silent_protocol::{Limits, SilentProto};

#[derive(Debug, PartialEq, Eq, SilentProto)]
struct Inner {
    x: u32,
}

#[derive(Debug, PartialEq, SilentProto)]
struct Outer {
    inner: Inner,
}

#[derive(Debug, PartialEq, SilentProto)]
struct InnerOptional {
    a: Option<u32>,
    b: u32,
}

#[derive(Debug, PartialEq, SilentProto)]
struct Deep {
    outer: Outer,
    note: String,
}

#[test]
fn nested_without_length_prefix() {
    assert_eq!(
        encode(&Outer {
            inner: Inner { x: 7 }
        }),
        vec![7]
    );
    roundtrip(&Outer {
        inner: Inner { x: u32::MAX },
    });
}

#[test]
fn nested_has_own_bitmap() {
    let value = InnerOptional { a: Some(5), b: 0 };
    assert_eq!(encode(&value), vec![1, 5, 0]);
    roundtrip(&value);
    roundtrip(&InnerOptional { a: None, b: 9 });
}

#[test]
fn deeply_nested() {
    let value = Deep {
        outer: Outer {
            inner: Inner { x: 3 },
        },
        note: "hi".into(),
    };
    assert_eq!(encode(&value), vec![2, b'h', b'i', 3]);
    roundtrip(&value);
}

#[derive(Debug, PartialEq, SilentProto)]
struct Counted {
    items: Vec<u32>,
}

#[test]
fn array_wire() {
    assert_eq!(encode(&Counted { items: vec![] }), vec![0]);
    assert_eq!(
        encode(&Counted {
            items: vec![1, 2, 3]
        }),
        vec![3, 1, 2, 3]
    );
    roundtrip(&Counted {
        items: (0..100).collect(),
    });
}

#[derive(Debug, PartialEq, SilentProto)]
struct MessageArray {
    items: Vec<Inner>,
}

#[test]
fn array_of_messages() {
    let value = MessageArray {
        items: vec![Inner { x: 1 }, Inner { x: 2 }],
    };
    assert_eq!(encode(&value), vec![2, 1, 2]);
    roundtrip(&value);
}

#[derive(Debug, PartialEq, SilentProto)]
struct OptionalMessageArray {
    items: Vec<Option<Inner>>,
}

#[test]
fn array_of_optional_messages() {
    let value = OptionalMessageArray {
        items: vec![Some(Inner { x: 1 }), None, Some(Inner { x: 3 })],
    };
    assert_eq!(encode(&value), vec![3, 5, 1, 3]);
    roundtrip(&value);
    roundtrip(&OptionalMessageArray { items: vec![] });
    roundtrip(&OptionalMessageArray {
        items: vec![None, None],
    });
}

#[derive(Debug, PartialEq, SilentProto)]
struct OptionalArray {
    items: Option<Vec<Option<Inner>>>,
}

#[test]
fn optional_array_of_optional_messages() {
    let value = OptionalArray {
        items: Some(vec![Some(Inner { x: 1 }), None]),
    };
    assert_eq!(encode(&value), vec![1, 2, 1, 1]);
    roundtrip(&value);
    assert_eq!(encode(&OptionalArray { items: None }), vec![0]);
    roundtrip(&OptionalArray { items: None });
    roundtrip(&OptionalArray {
        items: Some(vec![]),
    });
}

#[test]
fn depth_limit_encode_and_decode() {
    let outer = Outer {
        inner: Inner { x: 1 },
    };
    let limits = Limits::new(1, Limits::DEFAULT_MAX_SIZE);
    let mut out = Vec::new();
    let error = outer.encode_to_with_limits(&mut out, limits).unwrap_err();
    assert_eq!(error.code(), "limit.depth");

    let bytes = encode(&outer);
    let error = Outer::decode_with_limits(&bytes, limits).unwrap_err();
    assert_eq!(error.code(), "limit.depth");

    let ok_limits = Limits::new(2, Limits::DEFAULT_MAX_SIZE);
    let mut out = Vec::new();
    outer.encode_to_with_limits(&mut out, ok_limits).unwrap();
    assert_eq!(out, bytes);
}

#[test]
fn nested_truncated() {
    let error = Outer::decode(&[]).unwrap_err();
    assert_eq!(error.code(), "eof");
    let error = Deep::decode(&[1]).unwrap_err();
    assert_eq!(error.code(), "eof");
}

#[test]
fn decode_from_shared_decoder() {
    let bytes = encode(&Inner { x: 42 });
    let mut decoder = silent_protocol::Decoder::new(&bytes);
    let value = Inner::decode_from(&mut decoder).unwrap();
    assert_eq!(value, Inner { x: 42 });
    decoder.finish().unwrap();
    let decoded: Outer = decode(&bytes);
    assert_eq!(
        decoded,
        Outer {
            inner: Inner { x: 42 }
        }
    );
}
