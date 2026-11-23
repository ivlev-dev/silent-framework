mod common;

use common::{encode, roundtrip};
use silent_protocol::{Limits, SilentProto};

#[derive(Debug, PartialEq, SilentProto)]
struct U64Field {
    value: u64,
}

#[derive(Debug, PartialEq, SilentProto)]
struct I32Field {
    value: i32,
}

#[derive(Debug, PartialEq, SilentProto)]
struct Fixed32Field {
    #[proto(fixed32)]
    value: u32,
}

#[derive(Debug, PartialEq, SilentProto)]
struct Text {
    value: String,
}

#[derive(Debug, PartialEq, SilentProto)]
struct Array {
    value: Vec<u32>,
}

#[test]
fn eof_on_empty_input() {
    assert_eq!(U64Field::decode(&[]).unwrap_err().code(), "eof");
    assert_eq!(Text::decode(&[]).unwrap_err().code(), "eof");
}

#[test]
fn varint_overflow() {
    let bytes = [0xFFu8; 10];
    assert_eq!(U64Field::decode(&bytes).unwrap_err().code(), "overflow");
}

#[test]
fn int32_overflow() {
    let bytes = [0xFF, 0xFF, 0xFF, 0xFF, 0x1F];
    assert_eq!(I32Field::decode(&bytes).unwrap_err().code(), "overflow");
}

#[test]
fn truncated_fixed() {
    assert_eq!(Fixed32Field::decode(&[1, 2]).unwrap_err().code(), "eof");
}

#[test]
fn oversized_declared_length() {
    let bytes = [0xFF, 0xFF, 0xFF, 0xFF, 0x7F];
    assert_eq!(Text::decode(&bytes).unwrap_err().code(), "limit.size");
}

#[test]
fn decode_size_limit() {
    let bytes = encode(&Text {
        value: "abc".into(),
    });
    let limits = Limits::new(Limits::DEFAULT_MAX_DEPTH, 2);
    let error = Text::decode_with_limits(&bytes, limits).unwrap_err();
    assert_eq!(error.code(), "limit.size");
}

#[test]
fn encode_size_limit() {
    let value = Text {
        value: "abcdef".into(),
    };
    let limits = Limits::new(Limits::DEFAULT_MAX_DEPTH, 4);
    let mut out = Vec::new();
    let error = value.encode_to_with_limits(&mut out, limits).unwrap_err();
    assert_eq!(error.code(), "limit.size");
}

#[test]
fn array_count_limit() {
    let bytes = [0xFF, 0xFF, 0xFF, 0xFF, 0x0F];
    assert_eq!(Array::decode(&bytes).unwrap_err().code(), "limit.size");
    let limits = Limits::new(Limits::DEFAULT_MAX_DEPTH, 2);
    let bytes = encode(&Array {
        value: vec![1, 2, 3],
    });
    assert_eq!(
        Array::decode_with_limits(&bytes, limits)
            .unwrap_err()
            .code(),
        "limit.size"
    );
}

#[test]
fn trailing_bytes_after_decode_from() {
    let bytes = [0x02, 0x00];
    let mut decoder = silent_protocol::Decoder::new(&bytes);
    let value = I32Field::decode_from(&mut decoder).unwrap();
    assert_eq!(value, I32Field { value: 1 });
    assert_eq!(decoder.finish().unwrap_err().code(), "trailing");
}

#[test]
fn encode_to_appends() {
    let mut out = vec![0xAA];
    I32Field { value: -1 }.encode_to(&mut out).unwrap();
    assert_eq!(out, vec![0xAA, 0x01]);
}

#[test]
fn error_display_and_codes_are_stable() {
    let error = Text::decode(&[1, 0xFF]).unwrap_err();
    assert_eq!(error.code(), "utf8");
    assert!(!error.to_string().is_empty());
    let error = U64Field::decode(&[0xFF; 10]).unwrap_err();
    assert_eq!(error.to_string(), "integer does not fit the target type");
}

#[test]
fn limits_defaults() {
    let limits = Limits::default();
    assert_eq!(limits.max_depth, 256);
    assert_eq!(limits.max_size, 64 * 1024 * 1024);
}

#[test]
fn roundtrip_with_custom_limits() {
    let limits = Limits::new(16, 1024);
    let value = Text { value: "ok".into() };
    let mut out = Vec::new();
    value.encode_to_with_limits(&mut out, limits).unwrap();
    let decoded = Text::decode_with_limits(&out, limits).unwrap();
    assert_eq!(decoded, value);
    roundtrip(&value);
}
