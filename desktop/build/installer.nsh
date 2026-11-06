; PDF Lecture Reader: extra installer steps (electron-builder includes this file)
;   - an "extras" page: desktop shortcut, and "Read aloud" / "Edit" in the right-click menu for PDFs
;   - installs over 1.0.0, whose installer used the same Apps entry ("PDFLectureReader")
;   - the uninstaller offers to delete saved settings and recent documents

!define PLR_MENU "Software\Classes\SystemFileAssociations\.pdf\shell\PDFLectureReader"
!define PLR_MENU_EDIT "Software\Classes\SystemFileAssociations\.pdf\shell\PDFLectureReaderEdit"
!define PLR_LINK "$DESKTOP\PDF Lecture Reader.lnk"

!ifndef BUILD_UNINSTALLER
  !include "getProcessInfo.nsh"
  Var pid
  Var plrDesk
  Var plrMenu

  ; 1.0.0 registered the same "PDFLectureReader" entry but not electron-builder's own key, so its
  ; uninstaller isn't needed: the new files go into the same folder and the entry is rewritten.
  ; Skipping it means it can't ask questions halfway through or touch saved settings.
  !macro customCheckAppRunning
    !insertmacro _CHECK_APP_RUNNING
    ReadRegStr $R8 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallLocation
    ${if} $R8 == ""
      ReadRegStr $R9 SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" UninstallString
      ${if} $R9 != ""
        DeleteRegValue SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" UninstallString
        DeleteRegValue SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" QuietUninstallString
      ${endif}
    ${endif}
  !macroend

  !macro customPageAfterChangeDir
    Page custom plrExtrasShow plrExtrasLeave

    Function plrExtrasShow
      !insertmacro MUI_HEADER_TEXT "Choose extras" "Pick what else to set up."
      nsDialogs::Create 1018
      Pop $0
      ${NSD_CreateCheckbox} 0 0 100% 12u "Create a &desktop shortcut"
      Pop $R1
      ${NSD_CreateCheckbox} 0 20u 100% 12u "Add $\"Read aloud$\" and $\"Edit$\" to the &right-click menu for PDFs"
      Pop $R2
      ${NSD_CreateLabel} 0 44u 100% 20u "Your default PDF app does not change."
      Pop $0
      ${if} $plrDesk != "0"
        ${NSD_Check} $R1
      ${endif}
      ${if} $plrMenu != "0"
        ${NSD_Check} $R2
      ${endif}
      nsDialogs::Show
    FunctionEnd

    Function plrExtrasLeave
      ${NSD_GetState} $R1 $plrDesk
      ${NSD_GetState} $R2 $plrMenu
    FunctionEnd
  !macroend

  ; a silent install (no pages) gets both extras
  !macro customInstall
    ${if} $plrDesk != "0"
      CreateShortCut "${PLR_LINK}" "$appExe" "" "$appExe" 0 "" "" "Read any PDF aloud like a teacher"
    ${else}
      Delete "${PLR_LINK}"
    ${endif}
    ${if} $plrMenu != "0"
      WriteRegStr SHELL_CONTEXT "${PLR_MENU}" "" "Read aloud with PDF Lecture Reader"
      WriteRegStr SHELL_CONTEXT "${PLR_MENU}" "Icon" '"$appExe",0'
      WriteRegStr SHELL_CONTEXT "${PLR_MENU}\command" "" '"$appExe" "%1"'
      WriteRegStr SHELL_CONTEXT "${PLR_MENU_EDIT}" "" "Edit with PDF Lecture Reader"
      WriteRegStr SHELL_CONTEXT "${PLR_MENU_EDIT}" "Icon" '"$appExe",0'
      WriteRegStr SHELL_CONTEXT "${PLR_MENU_EDIT}\command" "" '"$appExe" --edit "%1"'
    ${else}
      DeleteRegKey SHELL_CONTEXT "${PLR_MENU}"
      DeleteRegKey SHELL_CONTEXT "${PLR_MENU_EDIT}"
    ${endif}
  !macroend
!endif

!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegKey SHELL_CONTEXT "${PLR_MENU}"
    DeleteRegKey SHELL_CONTEXT "${PLR_MENU_EDIT}"
    Delete "${PLR_LINK}"
    MessageBox MB_YESNO|MB_ICONQUESTION "Also delete PDF Lecture Reader's saved settings, reading positions and recent documents?$\r$\n$\r$\nYour own PDF files are not affected. Choose No if you plan to reinstall." /SD IDNO IDNO plrKeepData
      SetShellVarContext current
      RMDir /r "$APPDATA\PDF Lecture Reader"
      ${if} $installMode == "all"
        SetShellVarContext all
      ${endif}
    plrKeepData:
  ${endIf}
!macroend
