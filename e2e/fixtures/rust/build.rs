fn main() -> std::io::Result<()> {
    println!("cargo:rerun-if-changed=build.rs");
    std::fs::write("native-build-ran", "Cargo executed build.rs")
}
