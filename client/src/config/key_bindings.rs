use anyhow::{anyhow, Result};
use crossterm::event::KeyEvent;
use ratatui::crossterm::event::{KeyCode, KeyModifiers};
use serde::Deserialize;

use client_derive::{CheckChildrenDuplicates, CheckDuplicates};

#[derive(Clone, Debug, Deserialize, CheckChildrenDuplicates)]
#[serde(rename_all = "kebab-case")]
pub struct KeyBindings {
    pub movement: Movement,
    pub lobby: Lobby,
    pub join: Join,
    pub popup: Popup,
    pub miscellaneous: Miscellaneous,
}

impl KeyBindings {
    pub fn validate(&self) -> Result<()> {
        if self.children_have_duplicates() {
            // TODO: Change this error when working on https://github.com/tomgroenwoldt/new-keyglide/issues/25.
            return Err(anyhow!("Duplicate key_bindings..."));
        }

        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, CheckDuplicates)]
#[serde(rename_all = "kebab-case")]
pub struct Movement {
    pub left: KeyBinding,
    pub down: KeyBinding,
    pub right: KeyBinding,
    pub up: KeyBinding,
}

#[derive(Clone, Debug, Deserialize, CheckDuplicates)]
#[serde(rename_all = "kebab-case")]
pub struct Miscellaneous {
    pub unfocus: KeyBinding,
    pub toggle_full_screen: KeyBinding,
}

#[derive(Clone, Debug, Deserialize, CheckDuplicates)]
#[serde(rename_all = "kebab-case")]
pub struct Lobby {
    pub disconnect: KeyBinding,
    pub focus_chat: KeyBinding,
    pub focus_editor: KeyBinding,
    pub focus_goal: KeyBinding,
}

#[derive(Clone, Debug, Deserialize, CheckDuplicates)]
#[serde(rename_all = "kebab-case")]
pub struct Join {
    pub focus_lobby_list: KeyBinding,
    pub join_selected: KeyBinding,
    pub quickplay: KeyBinding,
    pub create: KeyBinding,
}

#[derive(Clone, Debug, Deserialize, CheckDuplicates)]
#[serde(rename_all = "kebab-case")]
pub struct Popup {
    pub confirm: KeyBinding,
    pub abort: KeyBinding,
}

#[derive(Clone, Debug, Deserialize, Hash, PartialEq, Eq)]
pub struct KeyBinding {
    #[serde(deserialize_with = "deserialize_user_key")]
    pub code: KeyCode,
    pub modifiers: Option<KeyModifiers>,
}

// Implement our own deserialization for user provided key codes. This
// allows the user to provide simple string values instead of something like
// this for a character, e.g., unfocus.code = { Char = 'q' }.
fn deserialize_user_key<'de, D>(deserializer: D) -> Result<KeyCode, D::Error>
where
    D: serde::de::Deserializer<'de>,
{
    use serde::de::Error;

    String::deserialize(deserializer)
        .and_then(|string| string_to_key_code(string).map_err(|err| Error::custom(err.to_string())))
}

fn string_to_key_code(key_code: String) -> Result<KeyCode> {
    let code = match key_code.as_str() {
        "Enter" => KeyCode::Enter,
        "Backspace" => KeyCode::Backspace,
        "Left" => KeyCode::Left,
        "Right" => KeyCode::Right,
        "Up" => KeyCode::Up,
        "Down" => KeyCode::Down,
        "Home" => KeyCode::Home,
        "End" => KeyCode::End,
        "PageUp" => KeyCode::PageUp,
        "PageDown" => KeyCode::PageDown,
        "Tab" => KeyCode::Tab,
        "BackTab" => KeyCode::BackTab,
        "Delete" => KeyCode::Delete,
        "Insert" => KeyCode::Insert,
        "Null" => KeyCode::Null,
        "Esc" => KeyCode::Esc,
        "CapsLock" => KeyCode::CapsLock,
        "ScrollLock" => KeyCode::ScrollLock,
        "NumLock" => KeyCode::NumLock,
        "PrintScreen" => KeyCode::PrintScreen,
        "Pause" => KeyCode::Pause,
        "Menu" => KeyCode::Menu,
        "KeypadBegin" => KeyCode::KeypadBegin,

        // Only single character keys are allowed.
        c if c.len() == 1 => {
            let c = c.chars().next().unwrap();
            KeyCode::Char(c)
        }
        _ => return Err(anyhow!("Key codes must be exactly one character long.")),
    };
    Ok(code)
}

impl PartialEq<KeyBinding> for KeyEvent {
    fn eq(&self, other: &KeyBinding) -> bool {
        if let Some(modifiers) = other.modifiers {
            return self.modifiers == modifiers && self.code == other.code;
        }
        self.code == other.code
    }
}
