use anyhow::{anyhow, Result};

/// Launch CodeBurn Desktop on Overview and leave the flyout. Never a floating pill.
pub fn open_desktop() -> Result<()> {
    #[cfg(windows)]
    {
        return open_windows_desktop();
    }
    #[cfg(not(windows))]
    {
        Err(anyhow!(
            "Open CodeBurn launches the Windows desktop app; this host is not Windows"
        ))
    }
}

#[cfg(windows)]
fn open_windows_desktop() -> Result<()> {
    for candidate in desktop_candidates() {
        if candidate.is_file() {
            spawn_desktop(&candidate)?;
            return Ok(());
        }
    }
    Err(anyhow!("CodeBurn desktop is not installed"))
}

#[cfg(windows)]
fn desktop_candidates() -> Vec<std::path::PathBuf> {
    let mut out = Vec::new();
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        let base = std::path::PathBuf::from(local).join("Programs");
        out.push(base.join("CodeBurn").join("CodeBurn.exe"));
        out.push(base.join("codeburn").join("CodeBurn.exe"));
        out.push(base.join("codeburn-desktop").join("CodeBurn.exe"));
    }
    if let Some(pf) = std::env::var_os("ProgramFiles") {
        out.push(std::path::PathBuf::from(pf).join("CodeBurn").join("CodeBurn.exe"));
    }
    out.extend(uninstall_install_locations());
    out
}

#[cfg(windows)]
fn uninstall_install_locations() -> Vec<std::path::PathBuf> {
    let mut out = Vec::new();
    let keys = [
        r"HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall",
        r"HKLM\Software\Microsoft\Windows\CurrentVersion\Uninstall",
        r"HKLM\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall",
    ];
    for key in keys {
        let output = crate::cli::system_command("reg.exe")
            .args(["query", key, "/s", "/f", "CodeBurn", "/d"])
            .output();
        let Ok(output) = output else { continue };
        let text = String::from_utf8_lossy(&output.stdout);
        let mut install: Option<std::path::PathBuf> = None;
        let mut display = String::new();
        for line in text.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with("HKEY_") {
                if is_desktop_display(&display) {
                    if let Some(dir) = install.take() {
                        out.push(dir.join("CodeBurn.exe"));
                    }
                }
                display.clear();
                install = None;
                continue;
            }
            if let Some(value) = reg_value(trimmed, "DisplayName") {
                display = value;
            }
            if let Some(value) = reg_value(trimmed, "InstallLocation") {
                install = Some(std::path::PathBuf::from(value));
            }
        }
        if is_desktop_display(&display) {
            if let Some(dir) = install {
                out.push(dir.join("CodeBurn.exe"));
            }
        }
    }
    out
}

#[cfg(windows)]
fn is_desktop_display(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower == "codeburn" || (lower.starts_with("codeburn") && !lower.contains("menubar"))
}

#[cfg(windows)]
fn reg_value(line: &str, name: &str) -> Option<String> {
    if !line.starts_with(name) {
        return None;
    }
    let rest = line.get(name.len()..)?;
    let idx = rest.find("REG_")?;
    let after = rest[idx..].split_once(char::is_whitespace)?.1.trim();
    if after.is_empty() {
        None
    } else {
        Some(after.to_string())
    }
}

#[cfg(windows)]
fn spawn_desktop(path: &std::path::Path) -> Result<()> {
    use std::os::windows::process::CommandExt;
    use std::process::Command;
    const DETACHED_PROCESS: u32 = 0x00000008;
    const CREATE_NEW_PROCESS_GROUP: u32 = 0x00000200;
    Command::new(path)
        .creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP)
        .spawn()
        .map_err(|err| anyhow!("failed to launch CodeBurn desktop: {err}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    #[cfg(windows)]
    #[test]
    fn desktop_display_skips_the_menubar_product() {
        assert!(super::is_desktop_display("CodeBurn"));
        assert!(!super::is_desktop_display("CodeBurn Menubar"));
        assert!(!super::is_desktop_display("CodeBurn menubar"));
    }
}
