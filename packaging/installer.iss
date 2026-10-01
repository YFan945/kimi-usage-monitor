; Kimi Monitor — Windows 安装包脚本（Inno Setup）
; 构建：ISCC.exe packaging\installer.iss
#define MyAppName "Kimi Monitor"
#define MyAppVersion "1.0.1"
#define MyAppPublisher "YFan945"
#define MyAppURL "https://github.com/YFan945/kimi-usage-monitor"
#define SourceDir ".."

[Setup]
AppId={{7C4B9E2A-6F31-4D8A-9B5C-1A2B3C4D5E6F}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
DefaultDirName={localappdata}\Programs\KimiMonitor
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir={#SourceDir}\dist
OutputBaseFilename=KimiMonitor-Setup-{#MyAppVersion}
SetupIconFile={#SourceDir}\public\favicon.ico
UninstallDisplayIcon={app}\KimiMonitor.exe
UninstallDisplayName={#MyAppName}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
CloseApplications=yes

[Languages]
Name: "chinese"; MessagesFile: "compiler:Languages\ChineseSimplified.isl"

[Files]
Source: "{#SourceDir}\dist\KimiMonitor.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourceDir}\public\favicon.ico"; DestDir: "{app}"; DestName: "KimiMonitor.ico"; Flags: ignoreversion
Source: "{#SourceDir}\README.md"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourceDir}\LICENSE"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\KimiMonitor.exe"; IconFilename: "{app}\KimiMonitor.ico"; Comment: "{#MyAppName}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\KimiMonitor.exe"; IconFilename: "{app}\KimiMonitor.ico"; Comment: "{#MyAppName}"

[Run]
Filename: "{app}\KimiMonitor.exe"; Description: "立即启动 {#MyAppName}"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{sys}\taskkill.exe"; Parameters: "/IM KimiMonitor.exe /F"; Flags: runhidden; RunOnceId: "KillMonitor"

[UninstallDelete]
Type: files; Name: "{app}\config.json"
Type: files; Name: "{app}\port.txt"
