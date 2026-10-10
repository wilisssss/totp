//! Detect and read a QR code out of an already decoded image (PNG/JPEG files
//! are decoded by the caller; clipboard screenshots arrive as raw pixels).

use crate::error::AppError;

/// Decode the first QR code found in an image.
pub fn decode_dynamic(image: image::DynamicImage) -> Result<String, AppError> {
    let mut prepared = rqrr::PreparedImage::prepare(image.to_luma8());
    let grids = prepared.detect_grids();

    for grid in grids {
        if let Ok((_meta, data)) = grid.decode() {
            let trimmed = data.trim();
            if !trimmed.is_empty() {
                return Ok(trimmed.to_string());
            }
        }
    }

    Err(AppError::Qr(
        "tidak ada QR code terdeteksi di gambar".to_string(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A QR rendered by our own encoder must survive the clipboard path:
    /// PNG bytes → RGBA pixels → decoded back to the same text.
    #[test]
    fn decodes_rgba_pixel_buffers() {
        let uri = "otpauth://totp/Example:user@example.com?secret=JBSWY3DPEEHS";
        let data_url = crate::qr::encode::to_data_url(uri).unwrap();
        let base64 = data_url
            .split_once(',')
            .expect("data URL prefix")
            .1
            .to_string();

        use base64::Engine as _;
        let png = base64::engine::general_purpose::STANDARD
            .decode(base64)
            .unwrap();
        let image = image::load_from_memory(&png).unwrap();

        let decoded = decode_dynamic(image::DynamicImage::ImageRgba8(image.to_rgba8())).unwrap();
        assert_eq!(decoded, uri);
    }

    #[test]
    fn rejects_untouched_image() {
        // A 16x16 solid grey PNG has no QR code in it.
        let mut buffer: Vec<u8> = Vec::new();
        let image = image::GrayImage::from_pixel(16, 16, image::Luma([128]));
        image
            .write_to(
                &mut std::io::Cursor::new(&mut buffer),
                image::ImageFormat::Png,
            )
            .unwrap();

        let decoded = image::load_from_memory(&buffer).unwrap();
        assert!(matches!(
            decode_dynamic(decoded).unwrap_err(),
            AppError::Qr(_)
        ));
    }
}
