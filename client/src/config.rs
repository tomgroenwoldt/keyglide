use anyhow::Result;
use general::General;
use key_bindings::KeyBindings;
use serde::Deserialize;

#[cfg(feature = "audio")]
use audio::Audio;

#[cfg(feature = "audio")]
mod audio;
mod general;
mod key_bindings;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub struct Config {
    #[cfg(feature = "audio")]
    pub audio: Audio,
    pub key_bindings: KeyBindings,
    pub general: General,
}

impl Config {
    /// # Validate configuration
    ///
    /// Checks whether there are obvious duplicates in leaf categories.
    pub fn validate(&self) -> Result<()> {
        self.key_bindings.validate()?;

        #[cfg(feature = "audio")]
        self.audio.validate()?;

        Ok(())
    }
}
