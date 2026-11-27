pub trait Clipboard {
    fn get_text(&mut self) -> Option<String>;
    fn set_text(&mut self, text: String);
}

#[derive(Default, Debug)]
pub struct MemoryClipboard {
    text: String,
}

impl MemoryClipboard {
    pub fn new() -> Self {
        Self::default()
    }
}

impl Clipboard for MemoryClipboard {
    fn get_text(&mut self) -> Option<String> {
        if self.text.is_empty() {
            None
        } else {
            Some(self.text.clone())
        }
    }

    fn set_text(&mut self, text: String) {
        self.text = text;
    }
}
