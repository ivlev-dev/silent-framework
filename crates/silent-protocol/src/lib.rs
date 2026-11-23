extern crate self as silent_protocol;

mod decoder;
mod encoder;
mod error;
mod schema;

pub use decoder::{Bitmap, Decoder};
pub use encoder::Encoder;
pub use error::ProtocolError;
pub use schema::{
    canonical, fingerprint, SchemaEntry, SchemaField, SchemaOneOf, SchemaType, SchemaVariant,
};
pub use silent_protocol_macros::SilentProto;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Limits {
    pub max_depth: u32,
    pub max_size: usize,
}

impl Limits {
    pub const DEFAULT_MAX_DEPTH: u32 = 256;
    pub const DEFAULT_MAX_SIZE: usize = 64 * 1024 * 1024;

    pub const fn new(max_depth: u32, max_size: usize) -> Self {
        Self {
            max_depth,
            max_size,
        }
    }
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            max_depth: Self::DEFAULT_MAX_DEPTH,
            max_size: Self::DEFAULT_MAX_SIZE,
        }
    }
}

pub trait ProtoEnum: Copy + Sized {
    const NAME: &'static str;

    fn to_proto(self) -> u32;

    fn from_proto(value: u32) -> Result<Self, ProtocolError>;
}

pub trait SilentProto: Sized {
    fn write(&self, encoder: &mut Encoder<'_>) -> Result<(), ProtocolError>;

    fn read(decoder: &mut Decoder<'_>) -> Result<Self, ProtocolError>;

    fn schema() -> Vec<SchemaEntry>;

    fn schema_hash() -> u64 {
        fingerprint(&Self::schema())
    }

    fn encode(&self) -> Result<Vec<u8>, ProtocolError> {
        let mut out = Vec::new();
        self.encode_to(&mut out)?;
        Ok(out)
    }

    fn encode_to(&self, out: &mut Vec<u8>) -> Result<(), ProtocolError> {
        self.encode_to_with_limits(out, Limits::default())
    }

    fn encode_to_with_limits(
        &self,
        out: &mut Vec<u8>,
        limits: Limits,
    ) -> Result<(), ProtocolError> {
        let mut encoder = Encoder::with_limits(out, limits);
        encoder.write_message(self)
    }

    fn decode(bytes: &[u8]) -> Result<Self, ProtocolError> {
        Self::decode_with_limits(bytes, Limits::default())
    }

    fn decode_with_limits(bytes: &[u8], limits: Limits) -> Result<Self, ProtocolError> {
        let mut decoder = Decoder::with_limits(bytes, limits);
        let value = decoder.read_message::<Self>()?;
        decoder.finish()?;
        Ok(value)
    }

    fn decode_from(decoder: &mut Decoder<'_>) -> Result<Self, ProtocolError> {
        decoder.read_message::<Self>()
    }
}
