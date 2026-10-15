//! Minimal hand-written bindings to the vendored libwavpack (decode only).
//! Only the functions the player needs — see vendor/wavpack/README.md for
//! why this isn't the `wavpack` crate (its -sys crate needs CMake + bindgen).

use std::ffi::{c_char, c_int, c_void, CString};
use std::path::Path;

use crate::error::{AppError, AppResult};

/// `MODE_FLOAT` from wavpack.h: samples are IEEE f32 bit patterns.
pub const MODE_FLOAT: c_int = 0x8;
/// `OPEN_FILE_UTF8` from wavpack.h: the filename is UTF-8, not ANSI.
const OPEN_FILE_UTF8: c_int = 0x80;

#[allow(non_snake_case)]
extern "C" {
    fn WavpackOpenFileInput(
        infilename: *const c_char,
        error: *mut c_char,
        flags: c_int,
        norm_offset: c_int,
    ) -> *mut c_void;
    fn WavpackCloseFile(wpc: *mut c_void) -> *mut c_void;
    fn WavpackGetSampleRate(wpc: *mut c_void) -> u32;
    fn WavpackGetNumChannels(wpc: *mut c_void) -> c_int;
    fn WavpackGetBitsPerSample(wpc: *mut c_void) -> c_int;
    fn WavpackGetMode(wpc: *mut c_void) -> c_int;
    fn WavpackGetNumSamples64(wpc: *mut c_void) -> i64;
    fn WavpackSeekSample64(wpc: *mut c_void, sample: i64) -> c_int;
    fn WavpackUnpackSamples(wpc: *mut c_void, buffer: *mut i32, samples: u32) -> u32;
}

/// Safe owner of a WavPack decode context.
pub struct WvReader {
    wpc: *mut c_void,
}

impl WvReader {
    pub fn open(path: &Path) -> AppResult<Self> {
        let c_path = CString::new(path.to_string_lossy().as_bytes())
            .map_err(|_| AppError::UnsupportedFormat(format!("{}: bad path", path.display())))?;
        let mut err_buf = [0 as c_char; 81];
        let wpc = unsafe {
            WavpackOpenFileInput(c_path.as_ptr(), err_buf.as_mut_ptr(), OPEN_FILE_UTF8, 0)
        };
        if wpc.is_null() {
            let msg = unsafe { std::ffi::CStr::from_ptr(err_buf.as_ptr()) }
                .to_string_lossy()
                .into_owned();
            return Err(AppError::UnsupportedFormat(format!(
                "{}: {msg}",
                path.display()
            )));
        }
        Ok(Self { wpc })
    }

    pub fn sample_rate(&self) -> u32 {
        unsafe { WavpackGetSampleRate(self.wpc) }
    }

    pub fn num_channels(&self) -> usize {
        (unsafe { WavpackGetNumChannels(self.wpc) }).max(1) as usize
    }

    pub fn bits_per_sample(&self) -> u32 {
        (unsafe { WavpackGetBitsPerSample(self.wpc) }).clamp(1, 32) as u32
    }

    pub fn mode(&self) -> c_int {
        unsafe { WavpackGetMode(self.wpc) }
    }

    pub fn num_samples(&self) -> i64 {
        unsafe { WavpackGetNumSamples64(self.wpc) }
    }

    pub fn seek_sample(&mut self, sample: i64) -> bool {
        unsafe { WavpackSeekSample64(self.wpc, sample) != 0 }
    }

    /// Unpack up to `frames` sample frames into `buffer` (which must hold
    /// `frames * num_channels()` i32 slots). Returns frames unpacked.
    pub fn unpack(&mut self, buffer: &mut [i32], frames: u32) -> u32 {
        debug_assert!(buffer.len() >= frames as usize * self.num_channels());
        unsafe { WavpackUnpackSamples(self.wpc, buffer.as_mut_ptr(), frames) }
    }
}

impl Drop for WvReader {
    fn drop(&mut self) {
        unsafe {
            WavpackCloseFile(self.wpc);
        }
    }
}
