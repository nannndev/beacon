//! Shared CLI error type. Mirrors Python's `CliProjectError`: any problem
//! that means "cannot safely construct this run" (bad project, bad args,
//! missing files) becomes one of these and maps to exit code 2.

use std::fmt;

#[derive(Debug, Clone)]
pub struct CliError(pub String);

impl fmt::Display for CliError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl std::error::Error for CliError {}

impl From<std::io::Error> for CliError {
    fn from(e: std::io::Error) -> Self {
        CliError(e.to_string())
    }
}

impl From<serde_yaml::Error> for CliError {
    fn from(e: serde_yaml::Error) -> Self {
        CliError(e.to_string())
    }
}

impl CliError {
    pub fn new(msg: impl Into<String>) -> Self {
        CliError(msg.into())
    }
}

pub type CliResult<T> = Result<T, CliError>;
