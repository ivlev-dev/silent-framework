#![allow(dead_code)]

use silent_protocol::SilentProto;

pub fn encode<T: SilentProto>(value: &T) -> Vec<u8> {
    value.encode().expect("encode failed")
}

pub fn decode<T: SilentProto>(bytes: &[u8]) -> T {
    T::decode(bytes).expect("decode failed")
}

pub fn roundtrip<T: SilentProto + PartialEq + core::fmt::Debug>(value: &T) {
    let bytes = encode(value);
    let decoded: T = decode(&bytes);
    assert_eq!(&decoded, value);
}
