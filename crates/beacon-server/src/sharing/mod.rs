//! LAN project sharing: a host exposes one project over pinned HTTPS, teammates
//! join with a pairing code, and edits sync through a revision log.
pub mod host;
pub mod privacy;
pub mod repository;
pub mod service;
pub mod tls;

pub use service::SharingService;
