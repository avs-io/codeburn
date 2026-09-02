use std::fs;
use std::path::PathBuf;

use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};

pub const DEFAULT_HOTKEY: &str = "Ctrl+Alt+B";

const BLOCKED: &[&str] = &["win+c", "super+c", "meta+c", "ctrl+shift+p", "control+shift+p"];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlanceConfig {
    #[serde(default = "default_hotkey")]
    pub hotkey: String,
    #[serde(default)]
    pub pin_hint_shown: bool,
}

fn default_hotkey() -> String {
    DEFAULT_HOTKEY.to_string()
}

impl Default for GlanceConfig {
    fn default() -> Self {
        Self {
            hotkey: default_hotkey(),
            pin_hint_shown: false,
        }
    }
}

pub fn normalize_hotkey(raw: &str) -> String {
    raw.split('+')
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .map(|part| {
            let lower = part.to_ascii_lowercase();
            match lower.as_str() {
                "control" | "ctrl" => "Ctrl".to_string(),
                "alt" | "option" => "Alt".to_string(),
                "shift" => "Shift".to_string(),
                "win" | "super" | "meta" | "cmd" => "Win".to_string(),
                _ if part.len() == 1 => lower.to_ascii_uppercase(),
                _ => part.to_string(),
            }
        })
        .collect::<Vec<_>>()
        .join("+")
}

pub fn is_blocked_hotkey(raw: &str) -> bool {
    BLOCKED.contains(&normalize_hotkey(raw).to_ascii_lowercase().as_str())
}

/// Configurable hotkey, falling back to Ctrl+Alt+B when the value would fight
/// Win+C (Windows Copilot/charm) or Ctrl+Shift+P (editor command palette).
pub fn effective_hotkey(raw: &str) -> String {
    let normalized = normalize_hotkey(raw);
    if normalized.is_empty() || is_blocked_hotkey(&normalized) {
        DEFAULT_HOTKEY.to_string()
    } else {
        normalized
    }
}

fn config_path() -> PathBuf {
    if let Ok(path) = std::env::var("CODEBURN_GLANCE_CONFIG") {
        if !path.is_empty() {
            return PathBuf::from(path);
        }
    }
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("codeburn")
        .join("windows-glance.json")
}

impl GlanceConfig {
    pub fn load() -> Self {
        Self::load_from(&config_path())
    }

    fn load_from(path: &std::path::Path) -> Self {
        match fs::read(path) {
            Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or_default(),
            Err(_) => Self::default(),
        }
    }

    pub fn save(&self) -> Result<()> {
        self.save_to(&config_path())
    }

    fn save_to(&self, path: &std::path::Path) -> Result<()> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(path, serde_json::to_vec_pretty(self)?)?;
        Ok(())
    }

    pub fn mark_pin_hint_shown(&mut self) -> Result<()> {
        self.pin_hint_shown = true;
        self.save()
    }

    pub fn set_hotkey(&mut self, raw: &str) -> Result<String> {
        if is_blocked_hotkey(raw) {
            return Err(anyhow!(
                "that shortcut fights a reserved chord (Win+C or Ctrl+Shift+P)"
            ));
        }
        let hotkey = effective_hotkey(raw);
        self.hotkey = hotkey.clone();
        self.save()?;
        Ok(hotkey)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_hotkey_is_ctrl_alt_b() {
        assert_eq!(DEFAULT_HOTKEY, "Ctrl+Alt+B");
        assert!(!is_blocked_hotkey(DEFAULT_HOTKEY));
    }

    #[test]
    fn blocks_win_c_and_ctrl_shift_p() {
        assert!(is_blocked_hotkey("Win+C"));
        assert!(is_blocked_hotkey("super+c"));
        assert!(is_blocked_hotkey("Ctrl+Shift+P"));
        assert_eq!(effective_hotkey("Win+C"), DEFAULT_HOTKEY);
        assert_eq!(effective_hotkey("Ctrl+Shift+P"), DEFAULT_HOTKEY);
    }

    #[test]
    fn set_hotkey_rejects_blocked_chords() {
        let mut config = GlanceConfig::default();
        assert!(is_blocked_hotkey("Win+C"));
        assert!(config.set_hotkey("Win+C").is_err());
        assert_eq!(config.hotkey, DEFAULT_HOTKEY);
        assert_eq!(effective_hotkey("Ctrl+Alt+G"), "Ctrl+Alt+G");
        assert!(!is_blocked_hotkey("Ctrl+Alt+G"));
        let dir = std::env::temp_dir().join(format!(
            "codeburn-glance-hotkey-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let _ = fs::create_dir_all(&dir);
        let path = dir.join("windows-glance.json");
        config.hotkey = "Ctrl+Alt+G".to_string();
        config.save_to(&path).unwrap();
        let loaded = GlanceConfig::load_from(&path);
        assert_eq!(loaded.hotkey, "Ctrl+Alt+G");
        let _ = fs::remove_dir_all(&dir);
    }
}
