; Included by Tauri's NSIS template before its pages are defined.

; The finish page offers a desktop shortcut and ticks it by default. The owner
; wants none, so the box starts unticked (it can still be ticked by hand).
!define MUI_FINISHPAGE_SHOWREADME_NOTCHECKED

; Silent and passive installs skip the finish page, and the template then
; makes the shortcut unconditionally; take it away again.
!macro NSIS_HOOK_POSTINSTALL
  ${If} $PassiveMode = 1
  ${OrIf} ${Silent}
    Delete "$DESKTOP\${PRODUCTNAME}.lnk"
  ${EndIf}
!macroend
