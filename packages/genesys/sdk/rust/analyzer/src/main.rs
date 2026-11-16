mod analyzer;
mod definitions;
mod model;
mod package;
mod paths;
mod syntax;

use analyzer::Analyzer;
use model::Output;
use std::io::{self, Read};

fn inspect_stdin() -> Result<Output, String> {
    let mut text = String::new();
    io::stdin()
        .read_to_string(&mut text)
        .map_err(|error| error.to_string())?;
    let input = serde_json::from_str(&text).map_err(|error| error.to_string())?;
    Analyzer::analyze(input)
}

fn main() {
    match inspect_stdin() {
        Ok(output) => println!("{}", serde_json::to_string(&output).unwrap()),
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(1);
        }
    }
}
