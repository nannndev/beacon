import hashlib
import os
import socket
import ssl
from datetime import datetime, timedelta, timezone

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID
import requests
from requests.adapters import HTTPAdapter
from urllib3 import PoolManager


class FingerprintAdapter(HTTPAdapter):
    """Pin a certificate fingerprint on the same TLS connection as the request."""

    def __init__(self, fingerprint: str, *args, **kwargs):
        self.fingerprint = fingerprint.replace(":", "").lower()
        super().__init__(*args, **kwargs)

    def init_poolmanager(self, connections, maxsize, block=False, **pool_kwargs):
        pool_kwargs.update(cert_reqs=ssl.CERT_NONE, assert_fingerprint=self.fingerprint)
        self.poolmanager = PoolManager(connections, maxsize, block=block, **pool_kwargs)

    def cert_verify(self, conn, url, verify, cert):
        # urllib3's assert_fingerprint performs the identity check immediately
        # after the TLS handshake and before an HTTP request body is sent.
        conn.cert_reqs = ssl.CERT_NONE
        conn.assert_fingerprint = self.fingerprint


def pinned_session(fingerprint: str) -> requests.Session:
    session = requests.Session()
    session.mount("https://", FingerprintAdapter(fingerprint))
    return session


def ensure_device_certificate(directory: str) -> tuple[str, str, str]:
    """Create one persistent self-signed identity certificate per Beacon data dir."""
    os.makedirs(directory, exist_ok=True)
    cert_path = os.path.join(directory, "sharing-cert.pem")
    key_path = os.path.join(directory, "sharing-key.pem")
    if not os.path.exists(cert_path) or not os.path.exists(key_path):
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, f"Beacon on {socket.gethostname()}")])
        now = datetime.now(timezone.utc)
        cert = (
            x509.CertificateBuilder()
            .subject_name(name).issuer_name(name).public_key(key.public_key())
            .serial_number(x509.random_serial_number())
            .not_valid_before(now - timedelta(minutes=5))
            .not_valid_after(now + timedelta(days=3650))
            .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
            .sign(key, hashes.SHA256())
        )
        with open(key_path, "wb") as handle:
            handle.write(key.private_bytes(
                serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                serialization.NoEncryption(),
            ))
        os.chmod(key_path, 0o600)
        with open(cert_path, "wb") as handle:
            handle.write(cert.public_bytes(serialization.Encoding.PEM))
    with open(cert_path, "rb") as handle:
        cert = x509.load_pem_x509_certificate(handle.read())
    fingerprint = cert.fingerprint(hashes.SHA256()).hex()
    return cert_path, key_path, fingerprint


def remote_fingerprint(address: str, timeout: float = 3) -> str:
    host, port_text = address.rsplit(":", 1)
    context = ssl.create_default_context()
    context.check_hostname = False
    context.verify_mode = ssl.CERT_NONE
    with socket.create_connection((host, int(port_text)), timeout=timeout) as raw:
        with context.wrap_socket(raw, server_hostname=host) as secured:
            certificate = secured.getpeercert(binary_form=True)
    return hashlib.sha256(certificate).hexdigest()


def format_fingerprint(value: str) -> str:
    return ":".join(value[index:index + 2].upper() for index in range(0, len(value), 2))
