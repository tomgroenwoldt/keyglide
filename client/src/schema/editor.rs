use std::{
    io::{BufWriter, Write},
    path::Path,
    sync::{Arc, Mutex},
};

use anyhow::Result;
use bytes::Bytes;
use portable_pty::{CommandBuilder, MasterPty, NativePtySystem, PtySize, PtySystem};
use ratatui::{
    crossterm::event::{KeyCode, KeyEvent, KeyModifiers},
    layout::Rect,
};
use tokio::sync::mpsc::{unbounded_channel, UnboundedSender};
use tui_term::vt100::Parser;

use crate::app::AppMessage;

pub struct Editor {
    pub sender: UnboundedSender<Bytes>,
    pub master_pty: Box<dyn MasterPty + Send>,
    pub parser: Arc<Mutex<Parser>>,
}

impl Editor {
    pub fn new(area: Rect, message_tx: UnboundedSender<AppMessage>) -> Result<Self> {
        let parser = Arc::new(Mutex::new(Parser::new(area.height, area.width, 0)));
        let pty_system = NativePtySystem::default();
        let cwd = std::env::current_dir().expect("Unable to access current working directory.");
        let mut cmd = CommandBuilder::new("helix");
        let path = Path::new("/tmp/test.rs");
        cmd.arg(path);
        cmd.cwd(cwd);

        let size = PtySize::default();
        let pair = pty_system.openpty(size)?;

        // Wait for the child to complete
        let mut child = pair.slave.spawn_command(cmd)?;

        let mut reader = pair.master.try_clone_reader().unwrap();

        {
            let parser = Arc::clone(&parser);
            tokio::spawn(async move {
                // Consume the output from the child
                // Can't read the full buffer, since that would wait for EOF
                let mut buf = [0u8; 8192];
                let mut processed_buf = Vec::new();
                loop {
                    let size = reader.read(&mut buf).unwrap();
                    if size == 0 {
                        break;
                    }
                    if size > 0 {
                        processed_buf.extend_from_slice(&buf[..size]);
                        parser.lock().unwrap().process(&processed_buf);

                        // Clear the processed portion of the buffer
                        processed_buf.clear();
                    }
                }
            });
        }

        let (tx, mut rx) = unbounded_channel::<Bytes>();

        let mut writer = BufWriter::new(pair.master.take_writer().unwrap());

        // Drop writer on purpose
        tokio::spawn(async move {
            while let Some(bytes) = rx.recv().await {
                writer.write_all(&bytes).unwrap();
                writer.flush().unwrap();
            }
        });

        let mut editor = Self {
            sender: tx,
            master_pty: pair.master,
            parser,
        };
        editor.resize(area.height, area.width)?;

        // Spawn a task that messages the application after
        // our editor instance terminates.
        tokio::spawn(async move {
            let _ = child.wait();
            message_tx
                .send(AppMessage::EditorTerminated)
                .expect("The message channel should not be closed");
        });

        Ok(editor)
    }

    pub fn handle_key_event(&mut self, event: KeyEvent) -> Result<()> {
        let bytes = self.key_to_bytes(event);
        self.sender.send(bytes)?;

        Ok(())
    }

    pub fn key_to_bytes(&mut self, key: KeyEvent) -> Bytes {
        let bytes = match key.code {
            KeyCode::Char(input) => {
                let mut byte = input as u8;
                if key.modifiers.contains(KeyModifiers::SHIFT) {
                    byte = input.to_ascii_uppercase() as u8;
                } else if key.modifiers.contains(KeyModifiers::CONTROL) {
                    byte = input as u8 & 0x1f;
                }
                vec![byte]
            }
            KeyCode::Enter => vec![13],
            KeyCode::Backspace => vec![8],
            KeyCode::Left => vec![27, 91, 68],
            KeyCode::Right => vec![27, 91, 67],
            KeyCode::Up => vec![27, 91, 65],
            KeyCode::Down => vec![27, 91, 66],
            KeyCode::Tab => vec![9],
            KeyCode::Home => vec![27, 91, 72],
            KeyCode::End => vec![27, 91, 70],
            KeyCode::PageUp => vec![27, 91, 53, 126],
            KeyCode::PageDown => vec![27, 91, 54, 126],
            KeyCode::BackTab => vec![27, 91, 90],
            KeyCode::Delete => vec![27, 91, 51, 126],
            KeyCode::Insert => vec![27, 91, 50, 126],
            KeyCode::Esc => vec![27],
            _ => vec![],
        };
        Bytes::from(bytes)
    }

    pub fn resize(&mut self, rows: u16, cols: u16) -> Result<()> {
        let rows = rows - 5;
        let cols = ((cols - 2) as f64 * 0.8) as u16;
        let pty_size = PtySize {
            rows,
            cols,
            ..Default::default()
        };
        self.master_pty.resize(pty_size)?;
        self.parser.lock().unwrap().set_size(rows, cols);
        Ok(())
    }
}
