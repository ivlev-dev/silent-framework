mod common;

use bytes::Bytes;
use common::{encode, roundtrip};
use silent_protocol::SilentProto;

#[derive(Debug, PartialEq, SilentProto)]
struct Text {
    value: String,
}

#[derive(Debug, PartialEq, SilentProto)]
struct Raw {
    value: Vec<u8>,
}

#[derive(Debug, PartialEq, SilentProto)]
struct Buffer {
    value: Bytes,
}

#[derive(Debug, PartialEq, SilentProto)]
struct Date {
    #[proto(date)]
    value: i64,
}

#[test]
fn string_wire() {
    assert_eq!(
        encode(&Text {
            value: String::new()
        }),
        vec![0]
    );
    assert_eq!(
        encode(&Text {
            value: "hello".into()
        }),
        vec![5, b'h', b'e', b'l', b'l', b'o']
    );
    roundtrip(&Text { value: "".into() });
}

#[test]
fn utf8_and_emoji() {
    let emoji = "😀";
    assert_eq!(emoji.len(), 4);
    assert_eq!(
        encode(&Text {
            value: emoji.into()
        }),
        vec![4, 0xF0, 0x9F, 0x98, 0x80]
    );
    let mixed = "Привет, мир! 🚀";
    roundtrip(&Text {
        value: mixed.into(),
    });
    assert_eq!(
        Text::decode(&encode(&Text {
            value: mixed.into()
        }))
        .unwrap()
        .value,
        mixed
    );
}

#[test]
fn bytes_wire() {
    assert_eq!(encode(&Raw { value: vec![] }), vec![0]);
    assert_eq!(
        encode(&Raw {
            value: vec![0, 0xFF]
        }),
        vec![2, 0, 0xFF]
    );
    roundtrip(&Raw {
        value: vec![0, 1, 2, 255],
    });
    assert_eq!(
        encode(&Buffer {
            value: Bytes::from_static(&[1, 2, 3])
        }),
        vec![3, 1, 2, 3]
    );
    roundtrip(&Buffer {
        value: Bytes::from_static(&[9, 8, 7]),
    });
}

#[test]
fn date_wire() {
    assert_eq!(encode(&Date { value: 0 }), vec![0]);
    assert_eq!(encode(&Date { value: -1 }), vec![1]);
    assert_eq!(
        encode(&Date {
            value: 1_700_000_000_000
        }),
        vec![0x80, 0xA0, 0xAB, 0xFE, 0xF9, 0x62]
    );
    roundtrip(&Date {
        value: 1_700_000_000_000,
    });
    roundtrip(&Date { value: i64::MIN });
    roundtrip(&Date { value: i64::MAX });
}

#[test]
fn invalid_utf8() {
    let error = Text::decode(&[1, 0xFF]).unwrap_err();
    assert_eq!(error.code(), "utf8");
}

#[test]
fn truncated_string() {
    let error = Text::decode(&[5, b'a']).unwrap_err();
    assert_eq!(error.code(), "eof");
}

#[test]
fn invalid_bool_byte() {
    #[derive(Debug, PartialEq, SilentProto)]
    struct Flag {
        value: bool,
    }
    let error = Flag::decode(&[2]).unwrap_err();
    assert_eq!(error.code(), "bool");
}
