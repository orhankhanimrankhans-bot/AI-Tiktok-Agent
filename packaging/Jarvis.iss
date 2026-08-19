#define MyAppName "Jarvis"
#define MyAppVersion "2.0.0-rc1"
#define MyAppExeName "Jarvis.exe"

[Setup]
AppId={{25C19AA9-D8AA-4C42-A5A4-4E769C897A37}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
DefaultDirName={localappdata}\Programs\Jarvis
DefaultGroupName=Jarvis
OutputDir=..\dist\installer
OutputBaseFilename=Jarvis-{#MyAppVersion}-Setup
PrivilegesRequired=lowest
Compression=lzma2
SolidCompression=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Files]
Source: "..\dist\Jarvis\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\Jarvis"; Filename: "{app}\{#MyAppExeName}"
Name: "{autodesktop}\Jarvis"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional icons:"

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "Launch Jarvis"; Flags: nowait postinstall skipifsilent

; User settings, databases, logs, backups, prompts, and staged updates live in
; %LOCALAPPDATA%\Jarvis and are never installed or removed by this package.
