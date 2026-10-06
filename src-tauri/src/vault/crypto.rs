//! Vault cryptography: Argon2id key derivation + AES-256-GCM envelope.
//!
//! Layout of a vault file (all fields JSON, all binary fields Base64):
//!
//! ```json
//! {
//!   "version": 1,
//!   "kdf": { "algo": "argon2id", "m_cost": 19456, "t_cost": 2, "p": 1, "len": 32 },
//!   "salt": "<random 16 bytes: derives the master key from the passphrase>",
//!   "verifier_salt": "<random 16 bytes>",
//!   "verifier": "<Argon2id(master_key, verifier_salt): proves the passphrase is right>",
//!   "nonce": "<random 12 bytes>",
//!   "ciphertext": "<AES-256-GCM(master_key, nonce, payload json)>"
//! }
//! ```

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Key, Nonce,
};
use argon2::{Algorithm as ArgonAlgorithm, Argon2, Params, Version};
use base64::Engine as _;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use subtle::ConstantTimeEq;
use zeroize::Zeroizing;

pub type MasterKey = Zeroizing<[u8; 32]>;

const SALT_LEN: usize = 16;
const NONCE_LEN: usize = 12;
const VAULT_VERSION: u32 = 1;

/// OWASP recommended Argon2id parameters for a 19 MiB budget.
pub fn default_kdf() -> KdfParams {
    KdfParams {
        algo: "argon2id".to_string(),
        m_cost: 19_456,
        t_cost: 2,
        p: 1,
        len: 32,
    }
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum CryptoError {
    #[error("Gagal menurunkan kunci enkripsi")]
    Kdf,
    #[error("Enkripsi gagal")]
    Encrypt,
    #[error("Dekripsi gagal: data rusak atau passphrase salah")]
    Decrypt,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct KdfParams {
    pub algo: String,
    pub m_cost: u32,
    pub t_cost: u32,
    pub p: u32,
    pub len: u32,
}

impl Default for KdfParams {
    fn default() -> Self {
        default_kdf()
    }
}

impl KdfParams {
    /// Clamp parameters read from disk so a corrupted file cannot ask for an
    /// absurd amount of memory during unlock.
    fn sanitized(&self) -> Result<Self, CryptoError> {
        let params = Self {
            algo: "argon2id".to_string(),
            m_cost: self.m_cost.clamp(8, 65_536),
            t_cost: self.t_cost.clamp(1, 10),
            p: self.p.clamp(1, 8),
            len: 32,
        };
        if self.algo != "argon2id" {
            return Err(CryptoError::Kdf);
        }
        Ok(params)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultFile {
    pub version: u32,
    pub kdf: KdfParams,
    pub salt: String,
    pub verifier_salt: String,
    pub verifier: String,
    pub nonce: String,
    pub ciphertext: String,
}

fn b64(bytes: &[u8]) -> String {
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

fn unb64(value: &str) -> Result<Vec<u8>, CryptoError> {
    base64::engine::general_purpose::STANDARD
        .decode(value)
        .map_err(|_| CryptoError::Decrypt)
}

fn random_bytes(len: usize) -> Vec<u8> {
    let mut bytes = vec![0_u8; len];
    rand::rng().fill_bytes(&mut bytes);
    bytes
}

fn argon(
    params: &KdfParams,
    password: &[u8],
    salt: &[u8],
    out: &mut [u8],
) -> Result<(), CryptoError> {
    let params = params.sanitized()?;
    let argon_params = Params::new(
        params.m_cost,
        params.t_cost,
        params.p,
        Some(params.len as usize),
    )
    .map_err(|_| CryptoError::Kdf)?;

    Argon2::new(ArgonAlgorithm::Argon2id, Version::V0x13, argon_params)
        .hash_password_into(password, salt, out)
        .map_err(|_| CryptoError::Kdf)
}

/// Derive the 32 byte master key used as the AES key.
pub fn derive_key(
    passphrase: &str,
    salt_b64: &str,
    kdf: &KdfParams,
) -> Result<MasterKey, CryptoError> {
    if passphrase.is_empty() {
        return Err(CryptoError::Kdf);
    }
    let salt = unb64(salt_b64)?;
    if salt.len() < 8 {
        return Err(CryptoError::Kdf);
    }

    let mut key = [0_u8; 32];
    argon(kdf, passphrase.as_bytes(), &salt, &mut key)?;
    Ok(Zeroizing::new(key))
}

/// Create a brand new vault: derive a fresh key, seal the payload and return
/// both so the caller can keep the key in memory.
pub fn seal(
    passphrase: &str,
    kdf: &KdfParams,
    plaintext: &[u8],
) -> Result<(MasterKey, VaultFile), CryptoError> {
    let salt = random_bytes(SALT_LEN);
    let verifier_salt = random_bytes(SALT_LEN);
    let salt_b64 = b64(&salt);

    let key = derive_key(passphrase, &salt_b64, kdf)?;
    let verifier = verifier_hash(&key, kdf, &verifier_salt)?;
    let (nonce, ciphertext) = encrypt(&key, plaintext)?;

    Ok((
        key,
        VaultFile {
            version: VAULT_VERSION,
            kdf: kdf.clone(),
            salt: salt_b64,
            verifier_salt: b64(&verifier_salt),
            verifier,
            nonce,
            ciphertext,
        },
    ))
}

fn verifier_hash(key: &MasterKey, kdf: &KdfParams, salt: &[u8]) -> Result<String, CryptoError> {
    let mut out = vec![0_u8; kdf.len as usize];
    argon(kdf, key.as_ref(), salt, &mut out)?;
    Ok(b64(&out))
}

/// Verify a derived key against the stored verifier (constant time).
pub fn check_verifier(key: &MasterKey, vault: &VaultFile) -> Result<bool, CryptoError> {
    let salt = unb64(&vault.verifier_salt)?;
    let actual = verifier_hash(key, &vault.kdf, &salt)?;
    let expected = &vault.verifier;

    if actual.len() != expected.len() {
        return Ok(false);
    }
    Ok(actual.as_bytes().ct_eq(expected.as_bytes()).into())
}

pub fn encrypt(key: &MasterKey, plaintext: &[u8]) -> Result<(String, String), CryptoError> {
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key.as_ref()));

    let mut nonce_bytes = [0_u8; NONCE_LEN];
    rand::rng().fill_bytes(&mut nonce_bytes);

    let ciphertext = cipher
        .encrypt(Nonce::from_slice(&nonce_bytes), plaintext)
        .map_err(|_| CryptoError::Encrypt)?;

    Ok((b64(&nonce_bytes), b64(&ciphertext)))
}

pub fn decrypt(
    key: &MasterKey,
    nonce_b64: &str,
    ciphertext_b64: &str,
) -> Result<Vec<u8>, CryptoError> {
    let nonce = unb64(nonce_b64)?;
    if nonce.len() != NONCE_LEN {
        return Err(CryptoError::Decrypt);
    }
    let ciphertext = unb64(ciphertext_b64)?;

    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key.as_ref()));
    cipher
        .decrypt(Nonce::from_slice(&nonce), ciphertext.as_ref())
        .map_err(|_| CryptoError::Decrypt)
}

/// Convenience: derive + verify + decrypt in one go. Used by tests; the
/// unlock command does the same steps separately so it can tell a wrong
/// passphrase apart from a corrupt vault.
#[cfg(test)]
fn open(vault: &VaultFile, passphrase: &str) -> Result<MasterKey, CryptoError> {
    let key = derive_key(passphrase, &vault.salt, &vault.kdf)?;
    if !check_verifier(&key, vault)? {
        return Err(CryptoError::Decrypt);
    }
    decrypt(&key, &vault.nonce, &vault.ciphertext)?;
    Ok(key)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seal_and_open_roundtrip() {
        let passphrase = "correct horse battery staple";
        let payload = br#"{"entries":[{"id":"1"}]}"#;

        let (key, vault) = seal(passphrase, &default_kdf(), payload).unwrap();
        let reopened = open(&vault, passphrase).unwrap();
        assert_eq!(key.as_ref(), reopened.as_ref());

        let plaintext = decrypt(&reopened, &vault.nonce, &vault.ciphertext).unwrap();
        assert_eq!(plaintext, payload);
    }

    #[test]
    fn wrong_passphrase_is_rejected() {
        let (_key, vault) = seal("right passphrase", &default_kdf(), b"payload").unwrap();

        assert_eq!(
            open(&vault, "wrong passphrase").unwrap_err(),
            CryptoError::Decrypt
        );
    }

    #[test]
    fn tampered_ciphertext_fails() {
        let passphrase = "pw";
        let (_key, mut vault) = seal(passphrase, &default_kdf(), b"payload").unwrap();

        let mut bytes = unb64(&vault.ciphertext).unwrap();
        bytes[0] ^= 0xff;
        vault.ciphertext = b64(&bytes);

        assert!(open(&vault, passphrase).is_err());
    }

    #[test]
    fn kdf_params_from_disk_are_clamped() {
        let params = KdfParams {
            algo: "argon2id".to_string(),
            m_cost: 4_000_000,
            t_cost: 999,
            p: 64,
            len: 64,
        };
        let safe = params.sanitized().unwrap();
        assert_eq!(safe.m_cost, 65_536);
        assert_eq!(safe.t_cost, 10);
        assert_eq!(safe.p, 8);
        assert_eq!(safe.len, 32);
    }

    #[test]
    fn unsupported_kdf_is_rejected() {
        let params = KdfParams {
            algo: "scrypt".to_string(),
            ..default_kdf()
        };
        assert_eq!(params.sanitized().unwrap_err(), CryptoError::Kdf);
    }

    #[test]
    fn empty_passphrase_is_rejected() {
        assert!(seal("", &default_kdf(), b"x").is_err());
    }
}
