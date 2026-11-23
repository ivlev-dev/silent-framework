use bytes::Bytes;

use crate::{Limits, ProtocolError, SilentProto};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Bitmap<'a> {
    bytes: &'a [u8],
}

impl<'a> Bitmap<'a> {
    pub fn new(bytes: &'a [u8]) -> Self {
        Self { bytes }
    }

    pub fn bytes(&self) -> &'a [u8] {
        self.bytes
    }

    pub fn len(&self) -> usize {
        self.bytes.len() * 8
    }

    pub fn is_empty(&self) -> bool {
        self.bytes.is_empty()
    }

    pub fn get(&self, index: usize) -> bool {
        self.bytes
            .get(index / 8)
            .is_some_and(|byte| byte & (1 << (index % 8)) != 0)
    }
}

pub struct Decoder<'a> {
    input: &'a [u8],
    position: usize,
    depth: u32,
    limits: Limits,
}

impl<'a> Decoder<'a> {
    pub fn new(input: &'a [u8]) -> Self {
        Self::with_limits(input, Limits::default())
    }

    pub fn with_limits(input: &'a [u8], limits: Limits) -> Self {
        Self {
            input,
            position: 0,
            depth: 0,
            limits,
        }
    }

    pub fn limits(&self) -> Limits {
        self.limits
    }

    pub fn depth(&self) -> u32 {
        self.depth
    }

    pub fn position(&self) -> usize {
        self.position
    }

    pub fn remaining(&self) -> usize {
        self.input.len() - self.position
    }

    pub fn is_empty(&self) -> bool {
        self.position == self.input.len()
    }

    pub fn finish(&self) -> Result<(), ProtocolError> {
        if self.is_empty() {
            Ok(())
        } else {
            Err(ProtocolError::TrailingBytes(self.remaining()))
        }
    }

    fn enter(&mut self) -> Result<(), ProtocolError> {
        if self.depth >= self.limits.max_depth {
            return Err(ProtocolError::depth_limit(self.limits.max_depth));
        }
        self.depth += 1;
        Ok(())
    }

    fn leave(&mut self) {
        self.depth -= 1;
    }

    pub fn read_message<T: SilentProto>(&mut self) -> Result<T, ProtocolError> {
        self.enter()?;
        let result = T::read(self);
        self.leave();
        result
    }

    fn take(&mut self, count: usize) -> Result<&'a [u8], ProtocolError> {
        let remaining = self.remaining();
        if count > remaining {
            return Err(ProtocolError::eof(count, remaining));
        }
        let start = self.position;
        self.position += count;
        Ok(&self.input[start..self.position])
    }

    pub fn read_varint(&mut self) -> Result<u64, ProtocolError> {
        let mut result = 0u64;
        let mut shift = 0u32;
        for index in 0..10 {
            let byte = self
                .input
                .get(self.position)
                .copied()
                .ok_or_else(|| ProtocolError::eof(1, 0))?;
            self.position += 1;
            if index == 9 && byte > 1 {
                return Err(ProtocolError::IntegerOverflow);
            }
            result |= u64::from(byte & 0x7f) << shift;
            if byte & 0x80 == 0 {
                return Ok(result);
            }
            shift += 7;
        }
        Err(ProtocolError::InvalidVarint)
    }

    pub fn read_bool(&mut self) -> Result<bool, ProtocolError> {
        match self.take(1)?[0] {
            0 => Ok(false),
            1 => Ok(true),
            other => Err(ProtocolError::InvalidBool(other)),
        }
    }

    pub fn read_int32(&mut self) -> Result<i32, ProtocolError> {
        let raw = self.read_varint()?;
        if raw > u64::from(u32::MAX) {
            return Err(ProtocolError::IntegerOverflow);
        }
        let value = raw as u32;
        Ok(((value >> 1) as i32) ^ -((value & 1) as i32))
    }

    pub fn read_int64(&mut self) -> Result<i64, ProtocolError> {
        let value = self.read_varint()?;
        Ok(((value >> 1) as i64) ^ -((value & 1) as i64))
    }

    pub fn read_uint32(&mut self) -> Result<u32, ProtocolError> {
        let raw = self.read_varint()?;
        u32::try_from(raw).map_err(|_| ProtocolError::IntegerOverflow)
    }

    pub fn read_uint64(&mut self) -> Result<u64, ProtocolError> {
        self.read_varint()
    }

    pub fn read_fixed32(&mut self) -> Result<u32, ProtocolError> {
        let bytes = self.take(4)?;
        let array: [u8; 4] = bytes
            .try_into()
            .map_err(|_| ProtocolError::eof(4, bytes.len()))?;
        Ok(u32::from_le_bytes(array))
    }

    pub fn read_fixed64(&mut self) -> Result<u64, ProtocolError> {
        let bytes = self.take(8)?;
        let array: [u8; 8] = bytes
            .try_into()
            .map_err(|_| ProtocolError::eof(8, bytes.len()))?;
        Ok(u64::from_le_bytes(array))
    }

    pub fn read_float32(&mut self) -> Result<f32, ProtocolError> {
        self.read_fixed32().map(f32::from_bits)
    }

    pub fn read_float64(&mut self) -> Result<f64, ProtocolError> {
        self.read_fixed64().map(f64::from_bits)
    }

    pub fn read_date(&mut self) -> Result<i64, ProtocolError> {
        self.read_int64()
    }

    pub fn read_enum_value(&mut self) -> Result<u32, ProtocolError> {
        self.read_uint32()
    }

    pub fn read_length(&mut self) -> Result<usize, ProtocolError> {
        let raw = self.read_varint()?;
        let length = usize::try_from(raw).map_err(|_| ProtocolError::IntegerOverflow)?;
        if length > self.limits.max_size {
            return Err(ProtocolError::size_limit(self.limits.max_size));
        }
        Ok(length)
    }

    pub fn read_string(&mut self) -> Result<String, ProtocolError> {
        let length = self.read_length()?;
        let bytes = self.take(length)?;
        let text = core::str::from_utf8(bytes).map_err(|_| ProtocolError::InvalidUtf8)?;
        Ok(text.to_owned())
    }

    pub fn read_bytes(&mut self) -> Result<Bytes, ProtocolError> {
        let length = self.read_length()?;
        let bytes = self.take(length)?;
        Ok(Bytes::copy_from_slice(bytes))
    }

    pub fn read_byte_vec(&mut self) -> Result<Vec<u8>, ProtocolError> {
        let length = self.read_length()?;
        let bytes = self.take(length)?;
        Ok(bytes.to_vec())
    }

    pub fn read_bitmap(&mut self, count: usize) -> Result<Bitmap<'a>, ProtocolError> {
        let length = count.div_ceil(8);
        let bytes = self.take(length)?;
        Ok(Bitmap::new(bytes))
    }
}
