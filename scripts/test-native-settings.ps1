param([Parameter(Mandatory=$true)][string]$DllPath,[ValidateSet('save','load')][string]$Mode)
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class SettingsProbe {
 [UnmanagedFunctionPointer(CallingConvention.Cdecl)] public delegate int Register(IntPtr types,int count,IntPtr name,IntPtr fn);
 [UnmanagedFunctionPointer(CallingConvention.Cdecl)] public delegate int Entry(ref API api);
 [UnmanagedFunctionPointer(CallingConvention.Cdecl)] public delegate IntPtr Call(IntPtr args);
 [StructLayout(LayoutKind.Sequential)] public struct API { public IntPtr register,version; public int type; public IntPtr ncm; }
 [DllImport("kernel32",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr LoadLibraryW(string path);
 [DllImport("kernel32",CharSet=CharSet.Ansi)] static extern IntPtr GetProcAddress(IntPtr module,string name);
 static Dictionary<string,Call> calls=new Dictionary<string,Call>();
 static Register register=(types,count,name,fn)=>{calls[Marshal.PtrToStringAnsi(name)]=(Call)Marshal.GetDelegateForFunctionPointer(fn,typeof(Call));return 0;};
 public static void Init(string path) {
  IntPtr module=LoadLibraryW(path); if(module==IntPtr.Zero)throw new Exception("LoadLibrary: "+Marshal.GetLastWin32Error());
  var entry=(Entry)Marshal.GetDelegateForFunctionPointer(GetProcAddress(module,"BetterNCMPluginMain"),typeof(Entry));
  var api=new API {register=Marshal.GetFunctionPointerForDelegate(register),type=16};entry(ref api);
 }
 public static string Load(){return Marshal.PtrToStringAnsi(calls["mac_glass.settings.load"](IntPtr.Zero));}
 public static string Save(string json){
  IntPtr text=Marshal.StringToHGlobalAnsi(json), args=Marshal.AllocHGlobal(IntPtr.Size);
  try {Marshal.WriteIntPtr(args,text);return Marshal.PtrToStringAnsi(calls["mac_glass.settings.save"](args));}
  finally {Marshal.FreeHGlobal(text);Marshal.FreeHGlobal(args);}
 }
}
'@
[SettingsProbe]::Init((Resolve-Path -LiteralPath $DllPath).Path)
if($Mode -eq 'save') {
    $result=[SettingsProbe]::Save('{"windowTransparency":33,"playbackTransparency":41,"lyricsColor":"#aabbcc","lyricsGradient":true}') | ConvertFrom-Json
    if(-not $result.saved){throw 'Save failed'}
    $bad=[SettingsProbe]::Save('invalid') | ConvertFrom-Json
    if($bad.saved){throw 'Invalid payload accepted'}
} else {
    $result=[SettingsProbe]::Load() | ConvertFrom-Json
    if(-not $result.ok -or $result.settings.windowTransparency -ne 33 -or $result.settings.playbackTransparency -ne 41 -or $result.settings.lyricsColor -ne '#aabbcc' -or -not $result.settings.lyricsGradient){throw 'Restart restore failed'}
}
Write-Output "PASS: native $Mode in $([IntPtr]::Size * 8)-bit process"
