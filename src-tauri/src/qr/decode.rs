//! Detect and read a QR code out of an image supplied as raw bytes.

use crate::error::AppError;

/// Decode the first QR code found in `bytes` (png/jpeg/webp/gif).
pub fn decode_image(bytes: &[u8]) -> Result<String, AppError> {
    let image = image::load_from_memory(bytes)
        .map_err(|error| AppError::Qr(format!("format gambar tidak didukung: {error}")))?;

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

        assert!(matches!(
            decode_image(&buffer).unwrap_err(),
            AppError::Qr(_)
        ));
    }

    #[test]
    fn rejects_garbage_bytes() {
        assert!(matches!(
            decode_image(b"definitely not an image").unwrap_err(),
            AppError::Qr(_)
        ));
    }
}
