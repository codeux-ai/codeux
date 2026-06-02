!include LogicLib.nsh
!include nsDialogs.nsh

Var CodeUxBetaCheckbox
Var CodeUxBetaAccepted

!ifndef BUILD_UNINSTALLER
!macro customPageAfterChangeDir
  Page custom CodeUxBetaPage CodeUxBetaPageLeave
!macroend

Function CodeUxBetaPage
  nsDialogs::Create 1018
  Pop $0

  ${If} $0 == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 32u "Code UX is still in beta. Things may not work as expected, and some behavior can change between releases."
  Pop $0

  ${NSD_CreateCheckbox} 0 48u 100% 18u "I understand this software is still in beta."
  Pop $CodeUxBetaCheckbox

  ${If} $CodeUxBetaAccepted == "1"
    ${NSD_Check} $CodeUxBetaCheckbox
  ${EndIf}

  nsDialogs::Show
FunctionEnd

Function CodeUxBetaPageLeave
  ${NSD_GetState} $CodeUxBetaCheckbox $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $CodeUxBetaAccepted "1"
  ${Else}
    MessageBox MB_ICONEXCLAMATION "Please confirm that you understand Code UX is still in beta."
    Abort
  ${EndIf}
FunctionEnd
!endif
