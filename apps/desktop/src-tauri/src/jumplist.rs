//! Windows taskbar jump list: right-clicking the taskbar icon offers
//! Play/Pause, Next and Previous tasks. Each task relaunches the exe with
//! `--media-control=<action>`; the single-instance plugin routes that argv
//! to the running instance, which forwards it as an smtc://control event.

#![cfg(windows)]

use std::mem::ManuallyDrop;

use windows::core::{Interface, GUID, PCWSTR, PWSTR};
use windows::Win32::Foundation::PROPERTYKEY;
use windows::Win32::System::Com::StructuredStorage::{
    PROPVARIANT, PROPVARIANT_0_0, PROPVARIANT_0_0_0,
};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED,
};
use windows::Win32::System::Variant::VT_LPWSTR;
use windows::Win32::UI::Shell::Common::IObjectCollection;
use windows::Win32::UI::Shell::PropertiesSystem::IPropertyStore;
use windows::Win32::UI::Shell::{
    DestinationList, EnumerableObjectCollection, ICustomDestinationList, IShellLinkW, ShellLink,
};

/// PKEY_Title (propkey.h): the display name of a jump list task.
const PKEY_TITLE: PROPERTYKEY = PROPERTYKEY {
    fmtid: GUID::from_u128(0xF29F85E0_4FF9_1068_AB91_08002B27B3D9),
    pid: 2,
};

const TASKS: &[(&str, &str)] = &[
    ("Play / Pause", "toggle"),
    ("Next track", "next"),
    ("Previous track", "prev"),
];

/// If a jump list task launched us (second instance), returns the action.
pub fn control_arg(argv: &[String]) -> Option<&str> {
    argv.iter()
        .find_map(|a| a.strip_prefix("--media-control="))
}

/// Builds (replaces) the app's jump list. Call once at startup.
pub fn install() -> windows::core::Result<()> {
    unsafe {
        // Ignore RPC_E_CHANGED_MODE etc. — some other component may already
        // have initialized COM on this thread with a different model.
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);

        let exe = std::env::current_exe()
            .map_err(|_| windows::core::Error::from(windows::Win32::Foundation::E_FAIL))?;
        let exe_w: Vec<u16> = exe
            .to_string_lossy()
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();

        let list: ICustomDestinationList =
            CoCreateInstance(&DestinationList, None, CLSCTX_INPROC_SERVER)?;
        let mut min_slots = 0u32;
        let _removed: windows::Win32::UI::Shell::Common::IObjectArray =
            list.BeginList(&mut min_slots)?;

        let collection: IObjectCollection =
            CoCreateInstance(&EnumerableObjectCollection, None, CLSCTX_INPROC_SERVER)?;

        for (title, action) in TASKS {
            let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)?;
            link.SetPath(PCWSTR(exe_w.as_ptr()))?;
            let args: Vec<u16> = format!("--media-control={action}")
                .encode_utf16()
                .chain(std::iter::once(0))
                .collect();
            link.SetArguments(PCWSTR(args.as_ptr()))?;
            // Icon: reuse the exe's embedded icon.
            link.SetIconLocation(PCWSTR(exe_w.as_ptr()), 0)?;

            // PKEY_Title must be a VT_LPWSTR scalar; the generated bindings
            // have no string constructor, so build it by hand. windows 0.61's
            // PROPVARIANT has a Drop impl that runs PropVariantClear ->
            // CoTaskMemFree(pwszVal); our pointer is into a stack Vec, not
            // CoTaskMem, so letting it drop corrupts the heap and crashes.
            // Wrap the whole PROPVARIANT in ManuallyDrop so it is never
            // cleared — SetValue copies the string, so title_w only has to
            // outlive this call.
            let store: IPropertyStore = link.cast()?;
            let title_w: Vec<u16> = title.encode_utf16().chain(std::iter::once(0)).collect();
            let value = ManuallyDrop::new(PROPVARIANT {
                Anonymous: windows::Win32::System::Com::StructuredStorage::PROPVARIANT_0 {
                    Anonymous: ManuallyDrop::new(PROPVARIANT_0_0 {
                        vt: VT_LPWSTR,
                        wReserved1: 0,
                        wReserved2: 0,
                        wReserved3: 0,
                        Anonymous: PROPVARIANT_0_0_0 {
                            pwszVal: PWSTR(title_w.as_ptr() as *mut u16),
                        },
                    }),
                },
            });
            store.SetValue(&PKEY_TITLE, &*value)?;
            store.Commit()?;

            collection.AddObject(&link)?;
        }

        list.AddUserTasks(&collection)?;
        list.CommitList()?;
    }
    Ok(())
}
