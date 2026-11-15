//! Self-signed device identity + fingerprint-pinned TLS (port of `sharing/tls.py`).
use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::crypto::CryptoProvider;
use rustls::pki_types::pem::PemObject;
use rustls::pki_types::{CertificateDer, PrivateKeyDer, ServerName, UnixTime};
use rustls::{DigitallySignedStruct, SignatureScheme};
use sha2::{Digest, Sha256};
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;
use tokio_rustls::TlsConnector;

pub struct DeviceIdentity {
    pub cert: CertificateDer<'static>,
    pub key: PrivateKeyDer<'static>,
    /// Lowercase hex SHA-256 of the DER certificate.
    pub fingerprint: String,
}

fn provider() -> Arc<CryptoProvider> {
    Arc::new(rustls::crypto::ring::default_provider())
}

pub fn fingerprint_of(cert: &CertificateDer<'_>) -> String {
    hex::encode(Sha256::digest(cert.as_ref()))
}

/// Create (once) and load the persistent identity certificate for this data dir.
/// Reuses `sharing-cert.pem` / `sharing-key.pem` written by the Python backend.
pub fn ensure_device_certificate(directory: &Path) -> Result<DeviceIdentity, String> {
    std::fs::create_dir_all(directory).map_err(|e| e.to_string())?;
    let cert_path = directory.join("sharing-cert.pem");
    let key_path = directory.join("sharing-key.pem");
    if !cert_path.exists() || !key_path.exists() {
        let key = rcgen::KeyPair::generate().map_err(|e| e.to_string())?;
        let mut params = rcgen::CertificateParams::new(Vec::<String>::new()).map_err(|e| e.to_string())?;
        params.distinguished_name.push(rcgen::DnType::CommonName, format!("Beacon on {}", super::host::hostname()));
        params.is_ca = rcgen::IsCa::ExplicitNoCa;
        let cert = params.self_signed(&key).map_err(|e| e.to_string())?;
        std::fs::write(&key_path, key.serialize_pem()).map_err(|e| e.to_string())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&key_path, std::fs::Permissions::from_mode(0o600));
        }
        std::fs::write(&cert_path, cert.pem()).map_err(|e| e.to_string())?;
    }
    let cert = CertificateDer::from_pem_file(&cert_path).map_err(|e| format!("sharing-cert.pem: {e}"))?;
    let key = PrivateKeyDer::from_pem_file(&key_path).map_err(|e| format!("sharing-key.pem: {e}"))?;
    let fingerprint = fingerprint_of(&cert);
    Ok(DeviceIdentity { cert, key, fingerprint })
}

pub fn server_config(identity: &DeviceIdentity) -> Result<rustls::ServerConfig, String> {
    let mut config = rustls::ServerConfig::builder_with_provider(provider())
        .with_safe_default_protocol_versions()
        .map_err(|e| e.to_string())?
        .with_no_client_auth()
        .with_single_cert(vec![identity.cert.clone()], identity.key.clone_key())
        .map_err(|e| e.to_string())?;
    config.alpn_protocols = vec![b"http/1.1".to_vec()];
    Ok(config)
}

/// Accepts any certificate, optionally requiring an exact SHA-256 fingerprint.
#[derive(Debug)]
struct PinVerifier {
    expected: Option<Vec<u8>>,
    provider: Arc<CryptoProvider>,
}

impl ServerCertVerifier for PinVerifier {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp: &[u8],
        _now: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        if let Some(expected) = &self.expected {
            let got = Sha256::digest(end_entity.as_ref());
            if got.as_slice() != expected.as_slice() {
                return Err(rustls::Error::General("Host certificate fingerprint does not match the pinned identity".into()));
            }
        }
        Ok(ServerCertVerified::assertion())
    }
    fn verify_tls12_signature(&self, message: &[u8], cert: &CertificateDer<'_>, dss: &DigitallySignedStruct) -> Result<HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls12_signature(message, cert, dss, &self.provider.signature_verification_algorithms)
    }
    fn verify_tls13_signature(&self, message: &[u8], cert: &CertificateDer<'_>, dss: &DigitallySignedStruct) -> Result<HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls13_signature(message, cert, dss, &self.provider.signature_verification_algorithms)
    }
    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.provider.signature_verification_algorithms.supported_schemes()
    }
}

fn client_config(fingerprint_hex: Option<&str>) -> Result<rustls::ClientConfig, String> {
    let expected = match fingerprint_hex {
        Some(fp) => Some(hex::decode(fp.replace(':', "").to_lowercase()).map_err(|_| "Invalid pinned fingerprint".to_string())?),
        None => None,
    };
    let provider = provider();
    Ok(rustls::ClientConfig::builder_with_provider(provider.clone())
        .with_safe_default_protocol_versions()
        .map_err(|e| e.to_string())?
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(PinVerifier { expected, provider }))
        .with_no_client_auth())
}

/// HTTPS client that only talks to the host whose certificate has this fingerprint.
pub fn pinned_client(fingerprint_hex: &str) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .use_preconfigured_tls(client_config(Some(fingerprint_hex))?)
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())
}

/// Hex SHA-256 fingerprint of the certificate presented at `host:port`.
pub async fn remote_fingerprint(address: &str) -> Result<String, String> {
    let (host, _) = address.rsplit_once(':').ok_or("Host address must be host:port")?;
    let stream = tokio::time::timeout(Duration::from_secs(3), tokio::net::TcpStream::connect(address))
        .await
        .map_err(|_| "Connection to the Beacon host timed out".to_string())?
        .map_err(|e| e.to_string())?;
    let server_name = ServerName::try_from(host.to_string()).map_err(|e| e.to_string())?;
    let connector = TlsConnector::from(Arc::new(client_config(None)?));
    let tls = tokio::time::timeout(Duration::from_secs(3), connector.connect(server_name, stream))
        .await
        .map_err(|_| "TLS handshake with the Beacon host timed out".to_string())?
        .map_err(|e| format!("TLS handshake failed: {e}"))?;
    let certs = tls.get_ref().1.peer_certificates().ok_or("Host presented no certificate")?;
    let first = certs.first().ok_or("Host presented no certificate")?;
    Ok(fingerprint_of(first))
}

pub fn format_fingerprint(value: &str) -> String {
    let clean = value.replace(':', "");
    clean
        .as_bytes()
        .chunks(2)
        .map(|c| String::from_utf8_lossy(c).to_uppercase())
        .collect::<Vec<_>>()
        .join(":")
}

pub fn normalize_fingerprint(value: &str) -> String {
    value.replace(':', "").to_lowercase()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The identity written by the Python backend (PKCS8 key + self-signed cert)
    /// must load unchanged so existing peers keep their pinned fingerprint.
    #[test]
    fn loads_existing_python_identity_without_rewriting_it() {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../config/sharing-identity");
        if !dir.join("sharing-key.pem").exists() {
            return;
        }
        let before = std::fs::read(dir.join("sharing-cert.pem")).unwrap();
        let identity = ensure_device_certificate(&dir).unwrap();
        assert_eq!(identity.fingerprint.len(), 64);
        assert_eq!(std::fs::read(dir.join("sharing-cert.pem")).unwrap(), before);
        assert!(server_config(&identity).is_ok());
    }

    #[test]
    fn generates_identity_once() {
        let dir = std::env::temp_dir().join(format!("beacon-tls-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let a = ensure_device_certificate(&dir).unwrap();
        let b = ensure_device_certificate(&dir).unwrap();
        assert_eq!(a.fingerprint, b.fingerprint);
        assert_eq!(format_fingerprint("abcd"), "AB:CD");
        std::fs::remove_dir_all(&dir).ok();
    }
}
