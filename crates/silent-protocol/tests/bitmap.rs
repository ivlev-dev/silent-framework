mod common;

use common::{decode, encode, roundtrip};
use silent_protocol::SilentProto;

#[derive(Debug, PartialEq, SilentProto)]
struct One {
    a: Option<u32>,
}

#[derive(Debug, PartialEq, SilentProto)]
struct Eight {
    a: Option<u32>,
    b: Option<u32>,
    c: Option<u32>,
    d: Option<u32>,
    e: Option<u32>,
    f: Option<u32>,
    g: Option<u32>,
    h: Option<u32>,
}

#[derive(Debug, PartialEq, SilentProto)]
struct Nine {
    a: Option<u32>,
    b: Option<u32>,
    c: Option<u32>,
    d: Option<u32>,
    e: Option<u32>,
    f: Option<u32>,
    g: Option<u32>,
    h: Option<u32>,
    i: Option<u32>,
}

#[derive(Debug, PartialEq, SilentProto)]
struct Unsorted {
    z: Option<u32>,
    a: Option<u32>,
}

#[test]
fn one_optional() {
    assert_eq!(encode(&One { a: None }), vec![0]);
    assert_eq!(encode(&One { a: Some(5) }), vec![1, 5]);
    roundtrip(&One { a: None });
    roundtrip(&One { a: Some(u32::MAX) });
}

#[test]
fn eight_optional_bitmap() {
    let none = Eight {
        a: None,
        b: None,
        c: None,
        d: None,
        e: None,
        f: None,
        g: None,
        h: None,
    };
    assert_eq!(encode(&none), vec![0]);

    let only_h = Eight { h: Some(9), ..none };
    assert_eq!(encode(&only_h), vec![0x80, 9]);

    let only_a = Eight {
        a: Some(1),
        ..only_h
    };
    assert_eq!(encode(&only_a), vec![0x81, 1, 9]);
    roundtrip(&only_a);
}

#[test]
fn nine_optional_bitmap() {
    let none = Nine {
        a: None,
        b: None,
        c: None,
        d: None,
        e: None,
        f: None,
        g: None,
        h: None,
        i: None,
    };
    assert_eq!(encode(&none), vec![0, 0]);

    let only_i = Nine { i: Some(7), ..none };
    assert_eq!(encode(&only_i), vec![0, 1, 7]);

    let all = Nine {
        a: Some(0),
        b: Some(0),
        c: Some(0),
        d: Some(0),
        e: Some(0),
        f: Some(0),
        g: Some(0),
        h: Some(0),
        i: Some(0),
    };
    assert_eq!(encode(&all), vec![0xFF, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    roundtrip(&all);
    roundtrip(&only_i);
}

#[test]
fn bitmap_order_by_name() {
    assert_eq!(
        encode(&Unsorted {
            z: Some(1),
            a: None
        }),
        vec![2, 1]
    );
    assert_eq!(
        encode(&Unsorted {
            z: None,
            a: Some(1)
        }),
        vec![1, 1]
    );
    assert_eq!(
        encode(&Unsorted {
            z: Some(1),
            a: Some(2)
        }),
        vec![3, 2, 1]
    );
    let decoded: Unsorted = decode(&[2, 1]);
    assert_eq!(
        decoded,
        Unsorted {
            z: Some(1),
            a: None
        }
    );
}

#[derive(Debug, PartialEq, SilentProto)]
struct Renamed {
    #[proto(rename = "z")]
    a: Option<u32>,
    b: Option<u32>,
}

#[test]
fn rename_changes_bitmap_order() {
    assert_eq!(
        encode(&Renamed {
            a: Some(1),
            b: None
        }),
        vec![2, 1]
    );
    assert_eq!(
        encode(&Renamed {
            a: None,
            b: Some(1)
        }),
        vec![1, 1]
    );
    let decoded: Renamed = decode(&[2, 1]);
    assert_eq!(
        decoded,
        Renamed {
            a: Some(1),
            b: None
        }
    );
}

#[derive(Debug, PartialEq, SilentProto)]
struct OptionalUnit {
    a: Option<()>,
    b: Option<u32>,
}

#[test]
fn optional_unit() {
    assert_eq!(encode(&OptionalUnit { a: None, b: None }), vec![0]);
    assert_eq!(
        encode(&OptionalUnit {
            a: Some(()),
            b: None
        }),
        vec![1]
    );
    assert_eq!(
        encode(&OptionalUnit {
            a: Some(()),
            b: Some(3)
        }),
        vec![3, 3]
    );
    roundtrip(&OptionalUnit {
        a: Some(()),
        b: Some(3),
    });
}

#[test]
fn truncated_bitmap() {
    let error = Nine::decode(&[0]).unwrap_err();
    assert_eq!(error.code(), "eof");
}
