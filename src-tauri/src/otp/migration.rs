//! Import from Google Authenticator's export QR codes.
//!
//! The export format is an `otpauth-migration://offline?data=<base64>` URI
//! whose payload is a small protobuf message:
//!
//! ```text
//! MigrationPayload {
//!   repeated OtpParameters otp_parameters = 1;
//! }
//! OtpParameters {
//!   bytes  secret    = 1;
//!   string name      = 2;  // "Issuer:Account" label
//!   string issuer    = 3;
//!   uint32 algorithm = 4;  // 1 SHA1, 2 SHA256, 3 SHA512, 4 MD5
//!   uint32 digits    = 5;  // 1 six, 2 eight
//!   uint32 kind      = 6;  // 1 HOTP, 2 TOTP
//!   uint64 counter   = 7;
//! }
//! ```
//!
//! Only the subset of protobuf used by this schema is decoded (varints and
//! length-delimited fields), so no protobuf dependency is needed.

use base64::Engine as _;

use super::entry::{EntryInput, OtpEntry};
use super::{uri, Algorithm, OtpError, OtpKind};

const PREFIX: &str = "otpauth-migration://";

#[derive(Debug, Default)]
struct OtpParameters {
    secret: Vec<u8>,
    name: String,
    issuer: String,
    algorithm: u32,
    digits: u32,
    kind: u32,
    counter: u64,
}

fn read_varint(bytes: &[u8], index: &mut usize) -> Result<u64, OtpError> {
    let mut value: u64 = 0;
    let mut shift = 0;
    loop {
        let byte = bytes
            .get(*index)
            .ok_or_else(|| OtpError::InvalidUri("protobuf terpotong".into()))?;
        *index += 1;
        value |= u64::from(byte & 0x7f) << shift;
        if byte & 0x80 == 0 {
            return Ok(value);
        }
        shift += 7;
        if shift >= 64 {
            return Err(OtpError::InvalidUri("varint terlalu panjang".into()));
        }
    }
}

/// Walk protobuf fields, feeding each `(field_number, payload)` to `sink`.
/// `wire_type` 0 carries the value itself, 2 carries a length prefix.
fn walk_fields(
    bytes: &[u8],
    mut sink: impl FnMut(u32, ProtobufValue<'_>) -> Result<(), OtpError>,
) -> Result<(), OtpError> {
    let mut index = 0;
    while index < bytes.len() {
        let tag = read_varint(bytes, &mut index)?;
        let field = u32::try_from(tag >> 3)
            .map_err(|_| OtpError::InvalidUri("nomor field protobuf tidak valid".into()))?;
        match tag & 0x7 {
            0 => {
                let value = read_varint(bytes, &mut index)?;
                sink(field, ProtobufValue::Varint(value))?;
            }
            2 => {
                let len = read_varint(bytes, &mut index)? as usize;
                let end = index
                    .checked_add(len)
                    .filter(|end| *end <= bytes.len())
                    .ok_or_else(|| OtpError::InvalidUri("protobuf terpotong".into()))?;
                sink(field, ProtobufValue::Bytes(&bytes[index..end]))?;
                index = end;
            }
            other => {
                return Err(OtpError::InvalidUri(format!(
                    "wire type protobuf tidak didukung: {other}"
                )));
            }
        }
    }
    Ok(())
}

#[derive(Debug)]
enum ProtobufValue<'a> {
    Varint(u64),
    Bytes(&'a [u8]),
}

impl ProtobufValue<'_> {
    fn as_bytes(&self) -> &[u8] {
        match self {
            Self::Bytes(bytes) => bytes,
            Self::Varint(_) => &[],
        }
    }

    fn as_string(&self) -> String {
        String::from_utf8_lossy(self.as_bytes()).into_owned()
    }

    fn as_uint(&self) -> u32 {
        match self {
            Self::Varint(value) => u32::try_from(*value).unwrap_or(u32::MAX),
            Self::Bytes(_) => 0,
        }
    }
}

/// Decode the `data=` parameter: standard or URL-safe base64, with or without
/// padding — Google's own tooling varies between them.
fn decode_data_param(raw: &str) -> Result<Vec<u8>, OtpError> {
    use base64::engine::general_purpose::{STANDARD, STANDARD_NO_PAD, URL_SAFE, URL_SAFE_NO_PAD};

    for engine in [STANDARD, URL_SAFE, STANDARD_NO_PAD, URL_SAFE_NO_PAD] {
        if let Ok(bytes) = engine.decode(raw) {
            return Ok(bytes);
        }
    }
    Err(OtpError::InvalidUri(
        "data migrasi bukan base64 yang valid".into(),
    ))
}

fn parse_otp_parameters(bytes: &[u8]) -> Result<OtpParameters, OtpError> {
    let mut params = OtpParameters::default();
    walk_fields(bytes, |field, value| {
        match field {
            1 => params.secret = value.as_bytes().to_vec(),
            2 => params.name = value.as_string(),
            3 => params.issuer = value.as_string(),
            4 => params.algorithm = value.as_uint(),
            5 => params.digits = value.as_uint(),
            6 => params.kind = value.as_uint(),
            7 => {
                params.counter = match value {
                    ProtobufValue::Varint(counter) => counter,
                    ProtobufValue::Bytes(_) => 0,
                }
            }
            _ => {}
        }
        Ok(())
    })?;
    Ok(params)
}

fn algorithm_of(code: u32) -> Result<Algorithm, OtpError> {
    match code {
        0 | 1 => Ok(Algorithm::Sha1),
        2 => Ok(Algorithm::Sha256),
        3 => Ok(Algorithm::Sha512),
        // Silently mapping MD5 to another hash would produce WRONG codes.
        4 => Err(OtpError::InvalidUri(
            "algoritma MD5 dari Google Authenticator tidak didukung".into(),
        )),
        other => Err(OtpError::InvalidUri(format!(
            "algoritma migrasi tidak dikenal: {other}"
        ))),
    }
}

fn to_entry(params: OtpParameters, timestamp: i64) -> Result<OtpEntry, String> {
    // The label follows the otpauth convention: first `:` separates issuer.
    let (label_issuer, account) = match params.name.split_once(':') {
        Some((issuer, account)) => (issuer, account),
        None => ("", params.name.as_str()),
    };

    let kind = match params.kind {
        1 => OtpKind::Hotp,
        _ => OtpKind::Totp,
    };

    let input = EntryInput {
        issuer: if params.issuer.is_empty() {
            label_issuer.to_string()
        } else {
            params.issuer.clone()
        },
        account: account.to_string(),
        // The migration payload carries raw key bytes; the vault stores
        // canonical Base32, so re-encode (empty bytes → empty secret → the
        // regular validation rejects it).
        secret: super::base32::encode(&params.secret),
        kind: Some(kind),
        algorithm: Some(algorithm_of(params.algorithm).map_err(|e| e.to_string())?),
        digits: Some(match params.digits {
            2 => 8,
            _ => 6,
        }),
        period: Some(30),
        counter: Some(params.counter),
    };

    OtpEntry::new(uuid::Uuid::new_v4().to_string(), &input, timestamp)
        .map_err(|error| error.to_string())
}

/// Parse an `otpauth-migration://` URI. The outer error covers a malformed
/// URI / payload; each exported entry reports its own error so one bad
/// parameter (e.g. MD5) does not discard the whole batch.
pub fn parse_uri(
    uri_text: &str,
    timestamp: i64,
) -> Result<Vec<Result<OtpEntry, String>>, OtpError> {
    let trimmed = uri_text.trim();
    if !trimmed
        .get(..PREFIX.len())
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case(PREFIX))
    {
        return Err(OtpError::InvalidUri(
            "bukan diawali dengan otpauth-migration://".into(),
        ));
    }

    let query = trimmed
        .split_once('?')
        .map(|(_, query)| query)
        .ok_or_else(|| OtpError::InvalidUri("parameter data tidak ditemukan".into()))?;

    let mut data: Option<String> = None;
    for pair in query.split('&') {
        if let Some((key, value)) = pair.split_once('=') {
            if key.eq_ignore_ascii_case("data") {
                data = Some(uri::percent_decode_public(value));
            }
        }
    }
    let data = data.ok_or_else(|| OtpError::InvalidUri("parameter data tidak ditemukan".into()))?;

    let payload = decode_data_param(&data)?;
    let mut results: Vec<Result<OtpEntry, String>> = Vec::new();
    walk_fields(&payload, |field, value| {
        if field == 1 {
            match parse_otp_parameters(value.as_bytes()) {
                Ok(params) => match to_entry(params, timestamp) {
                    Ok(entry) => results.push(Ok(entry)),
                    Err(reason) => results.push(Err(reason)),
                },
                Err(error) => results.push(Err(error.to_string())),
            }
        }
        Ok(())
    })?;

    if results.is_empty() {
        return Err(OtpError::InvalidUri(
            "tidak ada entri di dalam data migrasi".into(),
        ));
    }
    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn timestamp() -> i64 {
        1_700_000_000
    }

    /// Encode one protobuf field: length-delimited (`tag = field << 3 | 2`).
    fn field_bytes(field: u32, bytes: &[u8]) -> Vec<u8> {
        let mut out: Vec<u8> = vec![((field << 3) | 2) as u8];
        out.extend(bytes.len().to_varint());
        out.extend_from_slice(bytes);
        out
    }

    fn field_varint(field: u32, value: u64) -> Vec<u8> {
        let mut out: Vec<u8> = vec![(field << 3) as u8];
        out.extend(value.to_varint());
        out
    }

    /// Minimal varint encoding, mirrored from the reader under test.
    trait Varint {
        fn to_varint(self) -> Vec<u8>;
    }

    impl Varint for u64 {
        fn to_varint(self) -> Vec<u8> {
            let mut out = Vec::new();
            let mut value = self;
            loop {
                let byte = (value & 0x7f) as u8;
                value >>= 7;
                if value == 0 {
                    out.push(byte);
                    return out;
                }
                out.push(byte | 0x80);
            }
        }
    }

    impl Varint for usize {
        fn to_varint(self) -> Vec<u8> {
            (self as u64).to_varint()
        }
    }

    fn b64(bytes: &[u8]) -> String {
        use base64::engine::general_purpose::STANDARD;
        STANDARD.encode(bytes)
    }

    fn migration_uri(parameters: &[u8]) -> String {
        format!(
            "otpauth-migration://offline?data={}",
            b64(&field_bytes(1, parameters))
        )
    }

    #[test]
    fn parses_totp_parameters() {
        let mut parameters = Vec::new();
        parameters.extend(field_bytes(1, b"Hello!")); // secret
        parameters.extend(field_bytes(2, b"Example:user@example.com"));
        parameters.extend(field_bytes(3, b"Example"));
        parameters.extend(field_varint(4, 2)); // SHA256
        parameters.extend(field_varint(5, 1)); // 6 digits
        parameters.extend(field_varint(6, 2)); // TOTP

        let entries = parse_uri(&migration_uri(&parameters), timestamp()).unwrap();
        assert_eq!(entries.len(), 1);
        let entry = entries.into_iter().next().unwrap().unwrap();
        assert_eq!(entry.kind, OtpKind::Totp);
        assert_eq!(entry.issuer, "Example");
        assert_eq!(entry.account, "user@example.com");
        assert_eq!(entry.secret.as_str(), "JBSWY3DPEE");
        assert_eq!(entry.algorithm, Algorithm::Sha256);
        assert_eq!(entry.digits, 6);
    }

    #[test]
    fn parses_hotp_with_counter() {
        let mut parameters = Vec::new();
        parameters.extend(field_bytes(1, b"12345678901234567890"));
        parameters.extend(field_bytes(2, b"Octo"));
        parameters.extend(field_varint(6, 1)); // HOTP
        parameters.extend(field_varint(7, 300)); // counter, multi-byte varint

        let entries = parse_uri(&migration_uri(&parameters), timestamp()).unwrap();
        let entry = entries.into_iter().next().unwrap().unwrap();
        assert_eq!(entry.kind, OtpKind::Hotp);
        assert_eq!(entry.counter, 300);
        assert_eq!(entry.account, "Octo");
        assert_eq!(entry.issuer, "");
    }

    #[test]
    fn issuer_param_wins_over_label() {
        let mut parameters = Vec::new();
        parameters.extend(field_bytes(1, b"Hello!"));
        parameters.extend(field_bytes(2, b"LabelIssuer:acct"));
        parameters.extend(field_bytes(3, b"Real Issuer"));

        let entries = parse_uri(&migration_uri(&parameters), timestamp()).unwrap();
        let entry = entries.into_iter().next().unwrap().unwrap();
        assert_eq!(entry.issuer, "Real Issuer");
        assert_eq!(entry.account, "acct");
    }

    #[test]
    fn md5_entry_reports_error_but_batch_survives() {
        let mut good = Vec::new();
        good.extend(field_bytes(1, b"Hello!"));
        good.extend(field_bytes(2, b"Good Entry"));
        good.extend(field_varint(6, 2));

        let mut bad = Vec::new();
        bad.extend(field_bytes(1, b"Hello!"));
        bad.extend(field_varint(4, 4)); // MD5

        let mut payload = field_bytes(1, &good);
        payload.extend(field_bytes(1, &bad));

        // The payload already contains both `otp_parameters` fields, so it
        // must go into the URI as-is (migration_uri would wrap it again).
        let uri = format!("otpauth-migration://offline?data={}", b64(&payload));
        let entries = parse_uri(&uri, timestamp()).unwrap();
        assert_eq!(entries.len(), 2);
        assert!(entries[0].is_ok());
        assert!(entries[1].as_ref().is_err());
    }

    #[test]
    fn url_safe_unpadded_base64_is_accepted() {
        use base64::engine::general_purpose::URL_SAFE_NO_PAD;
        let mut parameters = Vec::new();
        parameters.extend(field_bytes(1, b"Hello!"));

        let payload = field_bytes(1, &parameters);
        let encoded = URL_SAFE_NO_PAD.encode(payload);
        let uri = format!("otpauth-migration://offline?data={encoded}");

        let entries = parse_uri(&uri, timestamp()).unwrap();
        assert_eq!(entries.len(), 1);
    }

    #[test]
    fn rejects_non_migration_uri() {
        assert!(parse_uri("otpauth://totp/x?secret=JBSWY3DPEE", timestamp()).is_err());
        assert!(parse_uri("otpauth-migration://offline", timestamp()).is_err());
    }
}
