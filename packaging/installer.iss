; KimiMonitor Node/SEA 维护版 — Windows 当前用户安装器（Inno Setup）
; 构建：ISCC.exe packaging\installer.iss
#define MyAppName "KimiMonitor"
#define MyAppVersion "1.2.5"
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

[Tasks]
Name: "startmenuicon"; Description: "创建开始菜单快捷方式"; GroupDescription: "附加任务："
Name: "desktopicon"; Description: "创建桌面快捷方式"; GroupDescription: "附加任务："

[Files]
Source: "{#SourceDir}\dist\KimiMonitor.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourceDir}\public\favicon.ico"; DestDir: "{app}"; DestName: "KimiMonitor.ico"; Flags: ignoreversion
Source: "{#SourceDir}\README.md"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourceDir}\LICENSE"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\KimiMonitor.exe"; IconFilename: "{app}\KimiMonitor.ico"; Comment: "查看本机 Kimi Code 调用次数与 token 用量（Node/SEA）"; Tasks: startmenuicon
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\KimiMonitor.exe"; IconFilename: "{app}\KimiMonitor.ico"; Comment: "查看本机 Kimi Code 调用次数与 token 用量（Node/SEA）"; Tasks: desktopicon

[Run]
Filename: "{app}\KimiMonitor.exe"; Description: "立即启动 {#MyAppName}"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{sys}\taskkill.exe"; Parameters: "/IM KimiMonitor.exe /F"; Flags: runhidden; RunOnceId: "KillMonitor"

[UninstallDelete]
Type: files; Name: "{app}\port.txt"
Type: files; Name: "{app}\KimiMonitor.ico"
Type: files; Name: "{app}\*.log"

[Code]
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usUninstall then
    if MsgBox('是否同时删除 KimiMonitor 的 config.json（扫描目录与首次引导设置）？' #13#10 #13#10 '选择“否”会保留此配置；本操作不删除 Kimi Code 原始会话。浏览器中的主题和筛选设置需在浏览器中单独清理。', mbConfirmation, MB_YESNO) = IDYES then
      DeleteFile(ExpandConstant('{app}\config.json'));
end;
