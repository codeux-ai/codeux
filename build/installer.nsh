!include LogicLib.nsh

!ifndef BUILD_UNINSTALLER
!include nsDialogs.nsh

!macro customPageAfterChangeDir
  Page custom CodeUxBetaPage
!macroend

Function CodeUxBetaPage
  nsDialogs::Create 1018
  Pop $0

  ${If} $0 == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 32u "Code UX is still in beta. Things may not work as expected, and some behavior can change between releases."
  Pop $0

  nsDialogs::Show
FunctionEnd
!endif
