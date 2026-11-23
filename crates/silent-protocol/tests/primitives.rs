mod common;

use common::{encode, roundtrip};
use silent_protocol::SilentProto;

#[derive(Debug, PartialEq, SilentProto)]
struct BoolField {
    value: bool,
}

#[derive(Debug, PartialEq, SilentProto)]
struct Int32Field {
    value: i32,
}

#[derive(Debug, PartialEq, SilentProto)]
struct Int64Field {
    value: i64,
}

#[derive(Debug, PartialEq, SilentProto)]
struct Uint32Field {
    value: u32,
}

#[derive(Debug, PartialEq, SilentProto)]
struct Uint64Field {
    value: u64,
}

#[derive(Debug, PartialEq, SilentProto)]
struct Fixed32Field {
    #[proto(fixed32)]
    value: u32,
}

#[derive(Debug, PartialEq, SilentProto)]
struct Fixed64Field {
    #[proto(fixed64)]
    value: u64,
}

#[derive(Debug, PartialEq, SilentProto)]
struct Float32Field {
    value: f32,
}

#[derive(Debug, PartialEq, SilentProto)]
struct Float64Field {
    value: f64,
}

#[derive(Debug, PartialEq, SilentProto)]
struct Explicit {
    #[proto(int32)]
    a: i32,
    #[proto(uint32)]
    b: u32,
    #[proto(int64)]
    c: i64,
    #[proto(uint64)]
    d: u64,
    #[proto(float32)]
    e: f32,
    #[proto(fixed32)]
    f: u32,
    #[proto(fixed64)]
    g: u64,
}

#[test]
fn bool_wire() {
    assert_eq!(encode(&BoolField { value: false }), vec![0]);
    assert_eq!(encode(&BoolField { value: true }), vec![1]);
    roundtrip(&BoolField { value: true });
}

#[test]
fn int32_wire() {
    let cases: &[(i32, &[u8])] = &[
        (0, &[0x00]),
        (-1, &[0x01]),
        (1, &[0x02]),
        (150, &[0xAC, 0x02]),
        (-64, &[0x7F]),
        (i32::MIN, &[0xFF, 0xFF, 0xFF, 0xFF, 0x0F]),
        (i32::MAX, &[0xFE, 0xFF, 0xFF, 0xFF, 0x0F]),
    ];
    for (value, expected) in cases {
        assert_eq!(encode(&Int32Field { value: *value }), *expected);
        roundtrip(&Int32Field { value: *value });
    }
}

#[test]
fn int64_wire() {
    let cases: &[(i64, &[u8])] = &[
        (0, &[0x00]),
        (-1, &[0x01]),
        (1, &[0x02]),
        (
            i64::MIN,
            &[0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0x01],
        ),
        (
            i64::MAX,
            &[0xFE, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0x01],
        ),
    ];
    for (value, expected) in cases {
        assert_eq!(encode(&Int64Field { value: *value }), *expected);
        roundtrip(&Int64Field { value: *value });
    }
}

#[test]
fn uint32_wire() {
    let cases: &[(u32, &[u8])] = &[
        (0, &[0x00]),
        (1, &[0x01]),
        (300, &[0xAC, 0x02]),
        (u32::MAX, &[0xFF, 0xFF, 0xFF, 0xFF, 0x0F]),
    ];
    for (value, expected) in cases {
        assert_eq!(encode(&Uint32Field { value: *value }), *expected);
        roundtrip(&Uint32Field { value: *value });
    }
}

#[test]
fn uint64_wire() {
    assert_eq!(encode(&Uint64Field { value: 0 }), vec![0]);
    assert_eq!(
        encode(&Uint64Field { value: u64::MAX }),
        vec![0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0x01]
    );
    roundtrip(&Uint64Field { value: u64::MAX });
}

#[test]
fn fixed_wire() {
    assert_eq!(
        encode(&Fixed32Field { value: 0x0102_0304 }),
        vec![0x04, 0x03, 0x02, 0x01]
    );
    assert_eq!(
        encode(&Fixed64Field {
            value: 0x0102_0304_0506_0708
        }),
        vec![0x08, 0x07, 0x06, 0x05, 0x04, 0x03, 0x02, 0x01]
    );
    roundtrip(&Fixed32Field { value: u32::MAX });
    roundtrip(&Fixed64Field { value: u64::MAX });
}

#[test]
fn float_wire() {
    assert_eq!(
        encode(&Float32Field { value: 1.0 }),
        vec![0x00, 0x00, 0x80, 0x3F]
    );
    assert_eq!(
        encode(&Float64Field { value: 1.0 }),
        vec![0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xF0, 0x3F]
    );
    assert_eq!(
        encode(&Float32Field { value: -0.0 }),
        (-0.0f32).to_bits().to_le_bytes()
    );
}

#[test]
fn float_non_finite() {
    for value in [f32::NAN, f32::INFINITY, f32::NEG_INFINITY] {
        let bytes = encode(&Float32Field { value });
        let restored = Float32Field::decode(&bytes).unwrap();
        if value.is_nan() {
            assert!(restored.value.is_nan());
            assert_eq!(restored.value.to_bits(), value.to_bits());
        } else {
            assert_eq!(restored.value, value);
        }
    }
    for value in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        let bytes = encode(&Float64Field { value });
        let restored = Float64Field::decode(&bytes).unwrap();
        if value.is_nan() {
            assert!(restored.value.is_nan());
            assert_eq!(restored.value.to_bits(), value.to_bits());
        } else {
            assert_eq!(restored.value, value);
        }
    }
}

#[test]
fn explicit_wire_attributes() {
    let value = Explicit {
        a: -2,
        b: 3,
        c: -4,
        d: 5,
        e: 6.5,
        f: 7,
        g: 8,
    };
    let bytes = encode(&value);
    let restored = Explicit::decode(&bytes).unwrap();
    assert_eq!(restored, value);
}

#[test]
fn trailing_bytes_rejected() {
    let error = Int32Field::decode(&[0x02, 0x00]).unwrap_err();
    assert_eq!(error.code(), "trailing");
}
