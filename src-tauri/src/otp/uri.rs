//! `otpauth://` URI parsing and serialisation (the interop format used by
//! QR codes and by every authenticator app).

use super::entry::{EntryInput, OtpEntry, MAX_DIGITS, MAX_PERIOD, MIN_DIGITS, MIN_PERIOD};
use super::{Algorithm, OtpError, OtpKind};

const PREFIX: &str = "otpauth://";

fn hex_digit(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

/// Decode percent escapes. When `plus_as_space` is enabled a literal `+` is
/// turned into a space, which is what vendors emit inside query values.
///
/// Byte based on purpose: a malformed escape (or one followed by a multi byte
/// character) must never panic.
fn percent_decode(input: &str, plus_as_space: bool) -> String {
    let bytes = input.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;

    while i < bytes.len() {
        match bytes[i] {
            b'%' if i + 2 < bytes.len() => {
                match (hex_digit(bytes[i + 1]), hex_digit(bytes[i + 2])) {
                    (Some(hi), Some(lo)) => {
                        out.push(hi * 16 + lo);
                        i += 3;
                    }
                    _ => {
                        out.push(bytes[i]);
                        i += 1;
                    }
                }
            }
            b'+' if plus_as_space => {
                out.push(b' ');
                i += 1;
            }
            byte => {
                out.push(byte);
                i += 1;
            }
        }
    }

    String::from_utf8_lossy(&out).into_owned()
}

/// Decode percent escapes for callers outside this module (e.g. the Google
/// Authenticator migration parser). `plus_as_space` is disabled there.
pub fn percent_decode_public(input: &str) -> String {
    percent_decode(input, false)
}

/// Encode a label/value so it is safe inside an `otpauth://` URI.
fn percent_encode(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for byte in input.bytes() {
        let is_unreserved =
            byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~');
        if is_unreserved {
            out.push(byte as char);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

fn parse_bounded<T>(raw: &str, min: T, max: T, name: &str) -> Result<T, OtpError>
where
    T: std::str::FromStr + PartialOrd,
{
    let value: T = raw
        .trim()
        .parse()
        .map_err(|_| OtpError::InvalidUri(format!("{name} bukan angka yang valid")))?;
    if value < min || value > max {
        return Err(OtpError::InvalidUri(format!(
            "{name} di luar rentang yang didukung"
        )));
    }
    Ok(value)
}

/// Parse a single `otpauth://` URI into an entry.
pub fn parse(uri: &str, timestamp: i64) -> Result<OtpEntry, OtpError> {
    let trimmed = uri.trim();
    if !trimmed
        .get(..PREFIX.len())
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case(PREFIX))
    {
        return Err(OtpError::InvalidUri(
            "bukan diawali dengan otpauth://".into(),
        ));
    }

    let rest = &trimmed[PREFIX.len()..];
    let (path, query) = rest
        .split_once('?')
        .ok_or_else(|| OtpError::InvalidUri("parameter tidak ditemukan".into()))?;
    let (kind_raw, label_raw) = path
        .split_once('/')
        .ok_or_else(|| OtpError::InvalidUri("label tidak ditemukan".into()))?;

    let kind = match kind_raw.to_ascii_lowercase().as_str() {
        "totp" => OtpKind::Totp,
        "hotp" => OtpKind::Hotp,
        other => return Err(OtpError::UnsupportedKind(other.to_string())),
    };

    let mut secret = String::new();
    let mut issuer_param: Option<String> = None;
    let mut algorithm = Algorithm::Sha1;
    let mut digits: Option<u8> = None;
    let mut period: Option<u64> = None;
    let mut counter: Option<u64> = None;

    for pair in query.split('&') {
        if pair.is_empty() {
            continue;
        }
        let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
        let key = key.to_ascii_lowercase();

        match key.as_str() {
            "secret" => secret = percent_decode(value, false),
            "issuer" => issuer_param = Some(percent_decode(value, true)),
            "algorithm" => {
                let raw = percent_decode(value, false);
                algorithm = Algorithm::parse(&raw).ok_or_else(|| {
                    OtpError::InvalidUri(format!("algoritma '{raw}' tidak didukung"))
                })?;
            }
            "digits" => digits = Some(parse_bounded(value, MIN_DIGITS, MAX_DIGITS, "digits")?),
            "period" => period = Some(parse_bounded(value, MIN_PERIOD, MAX_PERIOD, "period")?),
            "counter" => counter = Some(parse_bounded::<u64>(value, 0, u64::MAX, "counter")?),
            _ => continue,
        }
    }

    // Split the *raw* label first: `%3A` inside an issuer must not be mistaken
    // for the issuer/account separator.
    let (raw_issuer, raw_account) = match label_raw.split_once(':') {
        Some((issuer, account)) => (Some(issuer), account),
        None => (None, label_raw),
    };
    let label_issuer = raw_issuer
        .map(|value| percent_decode(value, false))
        .unwrap_or_default();
    let label_account = percent_decode(raw_account, false);

    let issuer = issuer_param.unwrap_or(label_issuer);

    let input = EntryInput {
        issuer,
        account: label_account,
        secret,
        kind: Some(kind),
        algorithm: Some(algorithm),
        digits: Some(digits.unwrap_or(6)),
        period: Some(period.unwrap_or(30)),
        counter: Some(counter.unwrap_or(0)),
    };

    OtpEntry::new(uuid::Uuid::new_v4().to_string(), &input, timestamp)
        .map_err(|error| OtpError::InvalidUri(error.to_string()))
}

/// Serialise an entry back into the canonical `otpauth://` URI form.
pub fn to_uri(entry: &OtpEntry) -> String {
    let label = match (entry.issuer.is_empty(), entry.account.is_empty()) {
        (true, _) => percent_encode(&entry.account),
        (_, true) => percent_encode(&entry.issuer),
        _ => format!(
            "{}:{}",
            percent_encode(&entry.issuer),
            percent_encode(&entry.account)
        ),
    };

    let mut query = format!("secret={}", entry.secret.as_str());
    if !entry.issuer.is_empty() {
        query.push_str(&format!("&issuer={}", percent_encode(&entry.issuer)));
    }
    query.push_str(&format!("&algorithm={}", entry.algorithm.as_uri_str()));
    query.push_str(&format!("&digits={}", entry.digits));

    match entry.kind {
        OtpKind::Totp => query.push_str(&format!("&period={}", entry.period)),
        OtpKind::Hotp => query.push_str(&format!("&counter={}", entry.counter)),
    }

    format!(
        "otpauth://{kind}/{label}?{query}",
        kind = entry.kind.as_uri_str()
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn timestamp() -> i64 {
        1_700_000_000
    }

    #[test]
    fn parses_typical_uri() {
        let entry = parse(
            "otpauth://totp/Example:user@example.com?secret=JBSWY3DPEEHS&issuer=Example&algorithm=SHA256&digits=8&period=60",
            timestamp(),
        )
        .unwrap();

        assert_eq!(entry.kind, OtpKind::Totp);
        assert_eq!(entry.issuer, "Example");
        assert_eq!(entry.account, "user@example.com");
        assert_eq!(entry.secret.as_str(), "JBSWY3DPEEHQ");
        assert_eq!(entry.algorithm, Algorithm::Sha256);
        assert_eq!(entry.digits, 8);
        assert_eq!(entry.period, 60);
    }

    #[test]
    fn label_without_colon_becomes_account() {
        let entry = parse(
            "otpauth://totp/Example?secret=JBSWY3DPEEHS&issuer=Example",
            timestamp(),
        )
        .unwrap();
        assert_eq!(entry.account, "Example");
        assert_eq!(entry.issuer, "Example");
    }

    /// Whatever the QR encodes must come back identical when another app
    /// re-parses it — issuer, account name and secret survive the trip.
    #[test]
    fn to_uri_roundtrip_preserves_credential() {
        let original = parse(
            "otpauth://totp/Example:user%40example.com?secret=JBSWY3DPEEHS&issuer=Example&algorithm=SHA256&digits=8&period=60",
            timestamp(),
        )
        .unwrap();
        let reparsed = parse(&to_uri(&original), timestamp()).unwrap();
        assert_eq!(reparsed.issuer, "Example");
        assert_eq!(reparsed.account, "user@example.com");
        assert_eq!(reparsed.secret.as_str(), original.secret.as_str());
        assert_eq!(reparsed.algorithm, Algorithm::Sha256);
        assert_eq!(reparsed.digits, 8);
        assert_eq!(reparsed.period, 60);

        // A label without an account part also survives (it re-parses with
        // the label as the account name, matching what scanners display).
        let issuer_only = parse(
            "otpauth://totp/Google?secret=JBSWY3DPEEHS&issuer=Google",
            timestamp(),
        )
        .unwrap();
        let reparsed = parse(&to_uri(&issuer_only), timestamp()).unwrap();
        assert_eq!(reparsed.issuer, "Google");
        assert_eq!(reparsed.account, "Google");
    }

    #[test]
    fn decodes_percent_escapes() {
        let entry = parse(
            "otpauth://totp/GitHub:octo%40mail.com?secret=JBSWY3DPEEHS&issuer=GitHub",
            timestamp(),
        )
        .unwrap();
        assert_eq!(entry.issuer, "GitHub");
        assert_eq!(entry.account, "octo@mail.com");

        // A label without an unencoded colon is a single account name.
        let entry = parse(
            "otpauth://totp/GitHub%3Aocto%40mail.com?secret=JBSWY3DPEEHS",
            timestamp(),
        )
        .unwrap();
        assert_eq!(entry.issuer, "");
        assert_eq!(entry.account, "GitHub:octo@mail.com");
    }

    #[test]
    fn rejects_bad_input() {
        assert!(parse("hello world", timestamp()).is_err());
        assert!(parse("otpauth://totp/Example", timestamp()).is_err());
        assert!(
            parse("otpauth://totp/Example?issuer=Example", timestamp()).is_err(),
            "missing secret"
        );
        assert!(
            parse(
                "otpauth://totp/Example?secret=JBSWY3DPEEHS&algorithm=MD5",
                timestamp()
            )
            .is_err(),
            "unsupported algorithm"
        );
        assert!(
            parse(
                "otpauth://totp/Example?secret=JBSWY3DPEEHS&digits=3",
                timestamp()
            )
            .is_err(),
            "out of range digits"
        );
        assert!(parse("otpauth://steam/Example?secret=JBSWY3DPEEHS", timestamp()).is_err());
    }

    #[test]
    fn roundtrips_through_uri() {
        let original = parse(
            "otpauth://hotp/Example:octo?secret=JBSWY3DPEEHS&issuer=Example&counter=42&digits=6",
            timestamp(),
        )
        .unwrap();
        let uri = to_uri(&original);
        let reparsed = parse(&uri, timestamp()).unwrap();

        assert_eq!(reparsed.issuer, original.issuer);
        assert_eq!(reparsed.account, original.account);
        assert_eq!(reparsed.secret.as_str(), original.secret.as_str());
        assert_eq!(reparsed.kind, original.kind);
        assert_eq!(reparsed.counter, original.counter);
        assert_eq!(reparsed.digits, original.digits);
    }

    #[test]
    fn percent_encode_escapes_non_unreserved_bytes() {
        assert_eq!(percent_encode("a b:c/d"), "a%20b%3Ac%2Fd");
        assert_eq!(percent_encode("A-Z._~09"), "A-Z._~09");
        assert_eq!(percent_encode("é"), "%C3%A9");
    }

    #[test]
    fn percent_decode_is_safe_with_malformed_escapes() {
        // A malformed escape (or one followed by a multi byte character) must
        // not panic and must be kept verbatim.
        assert_eq!(percent_decode("%zz%2", false), "%zz%2");
        assert_eq!(percent_decode("é%20x", false), "é x");
        assert_eq!(percent_decode("%E4%B8%AD", false), "中");
        assert_eq!(percent_decode("a+b", true), "a b");
        assert_eq!(percent_decode("a+b", false), "a+b");
    }

    #[test]
    fn encodes_special_characters_in_labels() {
        let mut entry = parse("otpauth://totp/x?secret=JBSWY3DPEEHS", timestamp()).unwrap();
        entry.issuer = "A B:C/D".into();
        entry.account = "e@mail.com".into();
        let uri = to_uri(&entry);

        let expected_label = format!(
            "{}:{}",
            percent_encode("A B:C/D"),
            percent_encode("e@mail.com")
        );
        assert!(
            uri.contains(&expected_label),
            "label {expected_label} tidak ada di {uri}"
        );

        let reparsed = parse(&uri, timestamp()).unwrap();
        assert_eq!(reparsed.issuer, "A B:C/D");
        assert_eq!(reparsed.account, "e@mail.com");
    }
}
