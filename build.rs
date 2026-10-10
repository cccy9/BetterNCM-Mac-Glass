#[cfg(windows)]
extern crate winres;

#[cfg(windows)]
fn main() {
    let output = std::path::PathBuf::from(std::env::var("OUT_DIR").unwrap());
    let version = std::env::var("CARGO_PKG_VERSION").unwrap();
    let source = "assets/mac-glass-theme";
    println!("cargo:rerun-if-changed={source}/main.js");
    println!("cargo:rerun-if-changed={source}/manifest.json");
    println!("cargo:rerun-if-changed=Cargo.toml");
    let js = std::fs::read_to_string(format!("{source}/main.js")).unwrap();
    assert!(js.contains("__MAC_GLASS_VERSION__"), "Version placeholder missing");
    std::fs::write(output.join("main.js"), js.replace("__MAC_GLASS_VERSION__", &version)).unwrap();
    let mut manifest: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(format!("{source}/manifest.json")).unwrap()).unwrap();
    manifest["version"] = version.clone().into();
    std::fs::write(output.join("manifest.json"), serde_json::to_vec_pretty(&manifest).unwrap()).unwrap();
    let mut res = winres::WindowsResource::new();
    res.set("ProductName", "BetterNCM Mac Glass");
    res.set("ProductVersion", &version);
    res.set("FileVersion", &version);
    res.set_manifest(
        r#"
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
<trustInfo xmlns="urn:schemas-microsoft-com:asm.v3">
    <security>
        <requestedPrivileges>
            <requestedExecutionLevel level="requireAdministrator" />
        </requestedPrivileges>
    </security>
</trustInfo>
</assembly>
"#,
    );
    res.compile().unwrap();
}

#[cfg(unix)]
fn main() {}
