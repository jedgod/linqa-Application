//! Minimal raw WebAssembly ABI for browser clients. It deliberately uses JSON
//! at the boundary so no generated JavaScript glue or duplicate crypto exists.

use crate::enrollment::EnrollmentChallenge;
use crate::ffi::{DecryptRequest, EncryptRequest, FfiCore};
use crate::identity::DeviceKeyMaterial;
use crate::key_package::{validate_key_package, KeyPackage};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};

static CORES: LazyLock<Mutex<HashMap<u32, FfiCore>>> = LazyLock::new(|| Mutex::new(HashMap::new()));
static NEXT_HANDLE: LazyLock<Mutex<u32>> = LazyLock::new(|| Mutex::new(1));

#[derive(Serialize)]
struct Response<T: Serialize> {
    ok: bool,
    value: Option<T>,
    error: Option<String>,
}

#[derive(Deserialize)]
struct KeyPackageRequest {
    user_id: String,
    device_id: String,
    created_at_unix: i64,
    expires_at_unix: i64,
}

#[derive(Deserialize)]
struct VerifyKeyPackageRequest {
    package: KeyPackage,
    /// The caller's clock: the module has no clock of its own in a browser.
    now_unix: i64,
}

#[derive(Deserialize)]
struct EnrollmentProofRequest {
    challenge: EnrollmentChallenge,
    device_name: String,
    platform: String,
}

#[derive(Deserialize)]
struct CallSealRequest {
    x25519: [u8; 32],
    mlkem768: Vec<u8>,
    plaintext: Vec<u8>,
    aad: Vec<u8>,
}
#[derive(Deserialize)]
struct CallOpenRequest { sealed: Vec<u8>, aad: Vec<u8> }
#[derive(Deserialize)]
struct CallSignRequest { message: Vec<u8> }

#[no_mangle]
pub extern "C" fn linqa_core_call_seal(handle: u32, pointer: u32, length: u32) -> u64 {
    match read_json::<CallSealRequest>(pointer, length) {
        Ok(r) => with_core(handle, |c| c.seal_call_key(r.x25519, r.mlkem768, &r.plaintext, &r.aad).map_err(crate::LinqaError::InvalidInput)),
        Err(e) => respond::<Vec<u8>>(Err(e)),
    }
}
#[no_mangle]
pub extern "C" fn linqa_core_call_open(handle: u32, pointer: u32, length: u32) -> u64 {
    match read_json::<CallOpenRequest>(pointer, length) {
        Ok(r) => with_core(handle, |c| c.open_call_key(&r.sealed, &r.aad).map_err(crate::LinqaError::InvalidInput)),
        Err(e) => respond::<Vec<u8>>(Err(e)),
    }
}
#[no_mangle]
pub extern "C" fn linqa_core_call_sign(handle: u32, pointer: u32, length: u32) -> u64 {
    match read_json::<CallSignRequest>(pointer, length) {
        Ok(r) => with_core(handle, |c| c.sign_call_message(&r.message).map_err(crate::LinqaError::InvalidInput)),
        Err(e) => respond::<Vec<u8>>(Err(e)),
    }
}

fn respond<T: Serialize>(result: crate::Result<T>) -> u64 {
    let response = match result {
        Ok(value) => Response {
            ok: true,
            value: Some(value),
            error: None,
        },
        Err(error) => Response::<T> {
            ok: false,
            value: None,
            error: Some(error.to_string()),
        },
    };
    let bytes = serde_json::to_vec(&response).unwrap_or_else(|_| {
        br#"{"ok":false,"value":null,"error":"serialization failure"}"#.to_vec()
    });
    leak(bytes)
}

fn leak(bytes: Vec<u8>) -> u64 {
    let length = bytes.len() as u32;
    let pointer = linqa_alloc(length);
    if length != 0 {
        // SAFETY: linqa_alloc returned a writable region of exactly `length` bytes.
        unsafe {
            std::ptr::copy_nonoverlapping(bytes.as_ptr(), pointer as *mut u8, length as usize)
        };
    }
    ((pointer as u64) << 32) | length as u64
}

fn read_json<T: for<'de> Deserialize<'de>>(pointer: u32, length: u32) -> crate::Result<T> {
    // SAFETY: callers allocate the region through linqa_alloc and pass its
    // exact pointer/length. The slice is read-only for this call.
    let bytes = unsafe { std::slice::from_raw_parts(pointer as *const u8, length as usize) };
    serde_json::from_slice(bytes).map_err(|_| crate::LinqaError::SerializationFailure)
}

fn with_core<T: Serialize>(
    handle: u32,
    operation: impl FnOnce(&FfiCore) -> crate::Result<T>,
) -> u64 {
    let cores = match CORES.lock() {
        Ok(cores) => cores,
        Err(_) => {
            return respond::<T>(Err(crate::LinqaError::InvalidState(
                "core registry poisoned",
            )))
        }
    };
    match cores.get(&handle) {
        Some(core) => respond(operation(core)),
        None => respond::<T>(Err(crate::LinqaError::InvalidState("unknown core handle"))),
    }
}

#[no_mangle]
pub extern "C" fn linqa_alloc(length: u32) -> u32 {
    if length == 0 {
        return 0;
    }
    let layout = std::alloc::Layout::array::<u8>(length as usize).expect("valid allocation layout");
    // SAFETY: layout is non-zero and valid. The matching layout is used by linqa_dealloc.
    unsafe { std::alloc::alloc(layout) as u32 }
}

#[no_mangle]
pub extern "C" fn linqa_dealloc(pointer: u32, length: u32) {
    if pointer == 0 || length == 0 {
        return;
    }
    let layout = std::alloc::Layout::array::<u8>(length as usize).expect("valid allocation layout");
    // SAFETY: pointer/length originated from linqa_alloc and is freed exactly once.
    unsafe { std::alloc::dealloc(pointer as *mut u8, layout) };
}

#[no_mangle]
pub extern "C" fn linqa_core_new(pointer: u32, length: u32) -> u64 {
    let core = if length == 0 {
        FfiCore::new()
    } else {
        read_json::<DeviceKeyMaterial>(pointer, length).and_then(FfiCore::from_key_material)
    };
    match core {
        Ok(core) => {
            let mut next = NEXT_HANDLE.lock().expect("handle counter");
            let handle = *next;
            *next = next.saturating_add(1);
            CORES.lock().expect("core registry").insert(handle, core);
            respond(Ok(handle))
        }
        Err(error) => respond::<u32>(Err(error)),
    }
}

#[no_mangle]
pub extern "C" fn linqa_core_drop(handle: u32) {
    if let Ok(mut cores) = CORES.lock() {
        cores.remove(&handle);
    }
}

#[no_mangle]
pub extern "C" fn linqa_core_runtime(handle: u32) -> u64 {
    with_core(handle, |core| Ok(core.runtime_info()))
}

#[no_mangle]
pub extern "C" fn linqa_core_public_identity(handle: u32) -> u64 {
    with_core(handle, |core| {
        Ok(serde_json::json!({
            "signingPublicKey": core.public_signing_key(),
            "encryptionPublicKey": core.public_encryption_key(),
            "pqEncryptionPublicKey": core.public_pq_encryption_key()
        }))
    })
}

#[no_mangle]
pub extern "C" fn linqa_core_export_keys(handle: u32) -> u64 {
    with_core(handle, |core| Ok(core.export_key_material()))
}

#[no_mangle]
pub extern "C" fn linqa_core_key_package(handle: u32, pointer: u32, length: u32) -> u64 {
    let request = match read_json::<KeyPackageRequest>(pointer, length) {
        Ok(request) => request,
        Err(error) => return respond::<crate::key_package::KeyPackage>(Err(error)),
    };
    with_core(handle, |core| {
        core.create_key_package(
            &request.user_id,
            &request.device_id,
            request.created_at_unix,
            request.expires_at_unix,
        )
    })
}

#[no_mangle]
pub extern "C" fn linqa_core_enrollment_proof(handle: u32, pointer: u32, length: u32) -> u64 {
    let request = match read_json::<EnrollmentProofRequest>(pointer, length) {
        Ok(request) => request,
        Err(error) => return respond::<crate::enrollment::EnrollmentProof>(Err(error)),
    };
    with_core(handle, |core| {
        core.create_enrollment_proof(&request.challenge, &request.device_name, &request.platform)
    })
}

#[no_mangle]
pub extern "C" fn linqa_core_encrypt(handle: u32, pointer: u32, length: u32) -> u64 {
    let request = match read_json::<EncryptRequest>(pointer, length) {
        Ok(request) => request,
        Err(error) => return respond::<crate::envelope::MessageEnvelope>(Err(error)),
    };
    with_core(handle, |core| core.encrypt(request))
}

#[no_mangle]
pub extern "C" fn linqa_core_decrypt(handle: u32, pointer: u32, length: u32) -> u64 {
    let request = match read_json::<DecryptRequest>(pointer, length) {
        Ok(request) => request,
        Err(error) => return respond::<Vec<u8>>(Err(error)),
    };
    with_core(handle, |core| core.decrypt(request))
}

/// Checks another device's key package: its signature, who it names, and that it has not expired. No core handle is needed.
#[no_mangle]
pub extern "C" fn linqa_verify_key_package(pointer: u32, length: u32) -> u64 {
    match read_json::<VerifyKeyPackageRequest>(pointer, length) {
        Ok(request) => respond(validate_key_package(&request.package, request.now_unix).map(|_| true)),
        Err(error) => respond::<bool>(Err(error)),
    }
}
