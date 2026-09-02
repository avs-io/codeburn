use anyhow::{anyhow, Result};
use global_hotkey::hotkey::{Code, HotKey, Modifiers};
use global_hotkey::{GlobalHotKeyEvent, GlobalHotKeyManager, HotKeyState};

use crate::glance::{effective_hotkey, is_blocked_hotkey};
#[cfg(test)]
use crate::glance::DEFAULT_HOTKEY;

/// Register the Glance hotkey on a background thread. A conflict or unsupported
/// host must not crash the tray — the flyout still opens from the icon.
pub fn listen(accel: &str, on_fire: impl Fn() + Send + 'static) -> Result<()> {
    let accel = effective_hotkey(accel);
    if is_blocked_hotkey(&accel) {
        return Err(anyhow!("blocked hotkey"));
    }
    let (mods, code) = parse_hotkey(&accel)?;
    let manager = GlobalHotKeyManager::new().map_err(|err| anyhow!("{err}"))?;
    let hotkey = HotKey::new(Some(mods), code);
    manager.register(hotkey).map_err(|err| anyhow!("{err}"))?;
    wait_hotkey_events(hotkey, on_fire);
    Ok(())
}

fn should_fire(event: GlobalHotKeyEvent, hotkey: HotKey) -> bool {
    event.id == hotkey.id && event.state != HotKeyState::Released
}

#[cfg(windows)]
fn wait_hotkey_events(hotkey: HotKey, on_fire: impl Fn()) {
    let receiver = GlobalHotKeyEvent::receiver();
    loop {
        pump_windows_messages();
        while let Ok(event) = receiver.try_recv() {
            if should_fire(event, hotkey) {
                on_fire();
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
}

/// Win32 delivers hotkey messages on the thread that created the manager.
#[cfg(windows)]
fn pump_windows_messages() {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        DispatchMessageW, PeekMessageW, TranslateMessage, MSG, PM_REMOVE,
    };
    // SAFETY: MSG is zeroed before PeekMessageW writes it; we only dispatch
    // messages this thread owns. Required so Win32 delivers the hotkey.
    unsafe {
        let mut msg = std::mem::zeroed::<MSG>();
        while PeekMessageW(&mut msg, std::ptr::null_mut(), 0, 0, PM_REMOVE) != 0 {
            TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
    }
}

#[cfg(not(windows))]
fn wait_hotkey_events(hotkey: HotKey, on_fire: impl Fn()) {
    for event in GlobalHotKeyEvent::receiver() {
        if should_fire(event, hotkey) {
            on_fire();
        }
    }
}

pub fn parse_hotkey(raw: &str) -> Result<(Modifiers, Code)> {
    let mut mods = Modifiers::empty();
    let mut key: Option<Code> = None;
    for part in raw.split('+').map(str::trim).filter(|p| !p.is_empty()) {
        match part.to_ascii_lowercase().as_str() {
            "ctrl" | "control" => mods |= Modifiers::CONTROL,
            "alt" | "option" => mods |= Modifiers::ALT,
            "shift" => mods |= Modifiers::SHIFT,
            "win" | "super" | "meta" | "cmd" => mods |= Modifiers::SUPER,
            other => {
                key = Some(code_from_token(other)?);
            }
        }
    }
    let code = key.ok_or_else(|| anyhow!("hotkey is missing a key"))?;
    if mods.is_empty() {
        return Err(anyhow!("hotkey needs a modifier"));
    }
    Ok((mods, code))
}

fn code_from_token(token: &str) -> Result<Code> {
    if token.len() == 1 {
        let ch = token.chars().next().unwrap().to_ascii_uppercase();
        return match ch {
            'A' => Ok(Code::KeyA),
            'B' => Ok(Code::KeyB),
            'C' => Ok(Code::KeyC),
            'D' => Ok(Code::KeyD),
            'E' => Ok(Code::KeyE),
            'F' => Ok(Code::KeyF),
            'G' => Ok(Code::KeyG),
            'H' => Ok(Code::KeyH),
            'I' => Ok(Code::KeyI),
            'J' => Ok(Code::KeyJ),
            'K' => Ok(Code::KeyK),
            'L' => Ok(Code::KeyL),
            'M' => Ok(Code::KeyM),
            'N' => Ok(Code::KeyN),
            'O' => Ok(Code::KeyO),
            'P' => Ok(Code::KeyP),
            'Q' => Ok(Code::KeyQ),
            'R' => Ok(Code::KeyR),
            'S' => Ok(Code::KeyS),
            'T' => Ok(Code::KeyT),
            'U' => Ok(Code::KeyU),
            'V' => Ok(Code::KeyV),
            'W' => Ok(Code::KeyW),
            'X' => Ok(Code::KeyX),
            'Y' => Ok(Code::KeyY),
            'Z' => Ok(Code::KeyZ),
            _ => Err(anyhow!("unsupported hotkey key {token}")),
        };
    }
    Err(anyhow!("unsupported hotkey key {token}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_default_ctrl_alt_b() {
        let (mods, code) = parse_hotkey(DEFAULT_HOTKEY).unwrap();
        assert!(mods.contains(Modifiers::CONTROL));
        assert!(mods.contains(Modifiers::ALT));
        assert!(!mods.contains(Modifiers::SUPER));
        assert_eq!(code, Code::KeyB);
    }

    #[test]
    fn parse_rejects_a_bare_letter() {
        assert!(parse_hotkey("B").is_err());
    }
}
