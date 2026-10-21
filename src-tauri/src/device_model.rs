//! The hardware model, for the account registration (docs/platform/665): what
//! the webview cannot see and plugin-os does not report. iOS answers from
//! sysctl `hw.machine` ("iPad14,1"), macOS from `hw.model` ("Mac14,2"), Android
//! from the `ro.product.model` system property ("Pixel 7"). Linux and Windows
//! answer None. Raw FFI against the system C library, so no crate is added.

#[tauri::command]
pub fn device_model() -> Option<String> {
    model()
}

#[cfg(target_os = "ios")]
fn model() -> Option<String> {
    sysctl_string("hw.machine")
}

#[cfg(target_os = "macos")]
fn model() -> Option<String> {
    sysctl_string("hw.model")
}

#[cfg(target_os = "android")]
fn model() -> Option<String> {
    use std::ffi::{c_char, c_int, CStr};
    extern "C" {
        fn __system_property_get(name: *const c_char, value: *mut c_char) -> c_int;
    }
    // PROP_VALUE_MAX is 92 bytes including the terminator.
    let mut buf = [0 as c_char; 92];
    let len = unsafe { __system_property_get(c"ro.product.model".as_ptr(), buf.as_mut_ptr()) };
    if len <= 0 {
        return None;
    }
    let value = unsafe { CStr::from_ptr(buf.as_ptr()) };
    Some(value.to_string_lossy().into_owned())
}

#[cfg(not(any(target_os = "ios", target_os = "macos", target_os = "android")))]
fn model() -> Option<String> {
    None
}

#[cfg(any(target_os = "ios", target_os = "macos"))]
fn sysctl_string(name: &str) -> Option<String> {
    use std::ffi::{c_char, c_int, c_void, CString};
    extern "C" {
        fn sysctlbyname(
            name: *const c_char,
            oldp: *mut c_void,
            oldlenp: *mut usize,
            newp: *mut c_void,
            newlen: usize,
        ) -> c_int;
    }
    let name = CString::new(name).ok()?;
    let mut len: usize = 0;
    // First call asks for the size, second fills the buffer.
    let rc = unsafe {
        sysctlbyname(name.as_ptr(), std::ptr::null_mut(), &mut len, std::ptr::null_mut(), 0)
    };
    if rc != 0 || len == 0 {
        return None;
    }
    let mut buf = vec![0u8; len];
    let rc = unsafe {
        sysctlbyname(name.as_ptr(), buf.as_mut_ptr().cast(), &mut len, std::ptr::null_mut(), 0)
    };
    if rc != 0 {
        return None;
    }
    buf.truncate(len);
    while buf.last() == Some(&0) {
        buf.pop();
    }
    String::from_utf8(buf).ok().filter(|s| !s.is_empty())
}
