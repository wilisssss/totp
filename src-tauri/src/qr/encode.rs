//! Render an `otpauth://` URI as a PNG data URL for the QR modal.

use base64::Engine as _;

use crate::error::AppError;

const MIN_SIZE: u32 = 256;

/// Returns `data:image/png;base64,...` for the given text.
pub fn to_data_url(text: &str) -> Result<String, AppError> {
    let code = qrcode::QrCode::new(text.as_bytes())
        .map_err(|error| AppError::Qr(format!("gagal membuat QR code: {error}")))?;

    let image = code
        .render::<image::Luma<u8>>()
        .min_dimensions(MIN_SIZE, MIN_SIZE)
        .build();

    let mut cursor = std::io::Cursor::new(Vec::new());
    image
        .write_to(&mut cursor, image::ImageFormat::Png)
        .map_err(|error| AppError::Qr(format!("gagal merender QR code: {error}")))?;

    let encoded = base64::engine::general_purpose::STANDARD.encode(cursor.into_inner());
    Ok(format!("data:image/png;base64,{encoded}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn produces_png_data_url() {
        let url = to_data_url("otpauth://totp/x?secret=JBSWY3DPEEHS").unwrap();
        assert!(url.starts_with("data:image/png;base64,"));
        assert!(url.len() > 100);
    }

    #[test]
    fn error_for_overlong_text() {
        let long = "x".repeat(4_000);
        assert!(matches!(to_data_url(&long).unwrap_err(), AppError::Qr(_)));
    }
}
