use crate::{Limits, ProtocolError, SilentProto};

pub struct Encoder<'a> {
    out: &'a mut Vec<u8>,
    start: usize,
    depth: u32,
    limits: Limits,
}

impl<'a> Encoder<'a> {
    pub fn new(out: &'a mut Vec<u8>) -> Self {
        Self::with_limits(out, Limits::default())
    }

    pub fn with_limits(out: &'a mut Vec<u8>, limits: Limits) -> Self {
        let start = out.len();
        Self {
            out,
            start,
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

    pub fn len(&self) -> usize {
        self.out.len() - self.start
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    fn check_size(&self, extra: usize) -> Result<(), ProtocolError> {
        let current = self.out.len() - self.start;
        let total = current
            .checked_add(extra)
            .ok_or_else(|| ProtocolError::size_limit(self.limits.max_size))?;
        if total > self.limits.max_size {
            return Err(ProtocolError::size_limit(self.limits.max_size));
        }
        Ok(())
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

    pub fn write_message<T: SilentProto>(&mut self, value: &T) -> Result<(), ProtocolError> {
        self.enter()?;
        let result = value.write(self);
        self.leave();
        result
    }

    pub fn write_raw(&mut self, bytes: &[u8]) -> Result<(), ProtocolError> {
        self.check_size(bytes.len())?;
        self.out.extend_from_slice(bytes);
        Ok(())
    }

    pub fn write_varint(&mut self, mut value: u64) -> Result<(), ProtocolError> {
        let mut buffer = [0u8; 10];
        let mut len = 0usize;
        loop {
            let byte = (value & 0x7f) as u8;
            value >>= 7;
            if value == 0 {
                buffer[len] = byte;
                len += 1;
                break;
            }
            buffer[len] = byte | 0x80;
            len += 1;
        }
        self.check_size(len)?;
        self.out.extend_from_slice(&buffer[..len]);
        Ok(())
    }

    pub fn write_bool(&mut self, value: bool) -> Result<(), ProtocolError> {
        self.write_raw(&[u8::from(value)])
    }

    pub fn write_int32(&mut self, value: i32) -> Result<(), ProtocolError> {
        let encoded = ((value << 1) ^ (value >> 31)) as u32;
        self.write_varint(u64::from(encoded))
    }

    pub fn write_int64(&mut self, value: i64) -> Result<(), ProtocolError> {
        let encoded = ((value << 1) ^ (value >> 63)) as u64;
        self.write_varint(encoded)
    }

    pub fn write_uint32(&mut self, value: u32) -> Result<(), ProtocolError> {
        self.write_varint(u64::from(value))
    }

    pub fn write_uint64(&mut self, value: u64) -> Result<(), ProtocolError> {
        self.write_varint(value)
    }

    pub fn write_fixed32(&mut self, value: u32) -> Result<(), ProtocolError> {
        self.write_raw(&value.to_le_bytes())
    }

    pub fn write_fixed64(&mut self, value: u64) -> Result<(), ProtocolError> {
        self.write_raw(&value.to_le_bytes())
    }

    pub fn write_float32(&mut self, value: f32) -> Result<(), ProtocolError> {
        self.write_raw(&value.to_bits().to_le_bytes())
    }

    pub fn write_float64(&mut self, value: f64) -> Result<(), ProtocolError> {
        self.write_raw(&value.to_bits().to_le_bytes())
    }

    pub fn write_date(&mut self, value: i64) -> Result<(), ProtocolError> {
        self.write_int64(value)
    }

    pub fn write_enum(&mut self, value: u32) -> Result<(), ProtocolError> {
        if value > i32::MAX as u32 {
            return Err(ProtocolError::EnumOutOfRange { value });
        }
        self.write_varint(u64::from(value))
    }

    pub fn write_length(&mut self, length: usize) -> Result<(), ProtocolError> {
        if length > self.limits.max_size {
            return Err(ProtocolError::size_limit(self.limits.max_size));
        }
        self.write_varint(length as u64)
    }

    pub fn write_string(&mut self, value: &str) -> Result<(), ProtocolError> {
        let bytes = value.as_bytes();
        self.write_length(bytes.len())?;
        self.write_raw(bytes)
    }

    pub fn write_bytes(&mut self, value: &[u8]) -> Result<(), ProtocolError> {
        self.write_length(value.len())?;
        self.write_raw(value)
    }
}
