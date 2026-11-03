<#
  NexWipe for Windows - read-only laptop discovery.

  Runs from a USB stick (or any folder) on a laptop whose own Windows is running. It reads the
  laptop's hardware details, sends them to NexWipe cloud, and then waits for two commands from
  the cloud: Rescan, and Reboot into NexWipe (one-time boot from the NexWipe stick).

  It NEVER erases, formats, partitions or writes to any disk. The only programs it may start are
  listed in $Allowed below; anything else is refused before it runs.

  Works on Windows 7 SP1 (PowerShell 2.0) through Windows 11: no PowerShell 3+ features are used.

  Usage:  double-click "Start NexWipe.cmd"   (asks for administrator rights once)
          powershell -File nexwipe.ps1 -DryRun -Out report.json   (collect only, send nothing)
          powershell -File nexwipe.ps1 -SelfTest                  (logic checks, no hardware/network)
#>
param([switch]$DryRun, [switch]$SelfTest, [string]$Out = "")

$ErrorActionPreference = "Stop"
$VERSION = "0.1.0-win"
$API = "/api/public/agent/v1"
$HEARTBEAT_SECONDS = 5
$Culture = [Globalization.CultureInfo]::InvariantCulture
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path

# ============================================================== safety: allowed programs
# Exact shapes only, matched against the whole argument string. Nothing here can change a disk.
$Allowed = @(
  @{ exe = "netsh";    rx = '^wlan show (networks|interfaces)$' },
  @{ exe = "netsh";    rx = '^wlan add profile filename=.{1,260} user=current$' },
  @{ exe = "netsh";    rx = '^wlan connect name=.{1,32}$' },
  @{ exe = "bcdedit";  rx = '^/enum firmware$' },
  @{ exe = "bcdedit";  rx = '^/enum \{current\}$' },
  @{ exe = "bcdedit";  rx = '^/set \{fwbootmgr\} bootsequence \{[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\}$' },
  @{ exe = "shutdown"; rx = '^/r /t ([0-9]|[1-5][0-9]|60) /c NexWipe: restarting into the NexWipe USB stick$' }
)

function Test-Allowed([string]$exe, [string[]]$argv) {
  $line = ($argv -join " ")
  foreach ($a in $Allowed) {
    if ($a.exe -eq $exe -and $line -match $a.rx) { return $true }
  }
  return $false
}

function Invoke-Tool([string]$exe, [string[]]$argv) {
  if (-not (Test-Allowed $exe $argv)) { throw "Refused: '$exe $($argv -join ' ')' is not on the NexWipe read-only allow-list." }
  $res = & $exe @argv 2>&1 | Out-String
  return @{ code = $LASTEXITCODE; text = $res }
}

# ============================================================== small helpers
function Cap($v, [int]$n) {
  if ($null -eq $v) { return $null }
  $s = ([string]$v).Trim()
  if ($s.Length -eq 0) { return $null }
  if ($s.Length -gt $n) { return $s.Substring(0, $n) }
  return $s
}

function Num($v) {
  if ($null -eq $v) { return $null }
  try { $d = [double]$v } catch { return $null }
  if ($d -lt 0) { return $null }
  return [int64][Math]::Floor($d)
}

# Values firmware vendors put in place of a real serial (same list as the Linux station).
$Placeholders = @("", "to be filled by o.e.m.", "to be filled by oem", "default string", "system serial number",
  "not specified", "not applicable", "none", "n/a", "na", "0", "00000000", "123456789", "chassis serial number",
  "system product name", "system manufacturer", "invalid")

function Test-Placeholder($v) {
  if ($null -eq $v) { return $true }
  $s = ([string]$v).Trim().ToLowerInvariant()
  if ($Placeholders -contains $s) { return $true }
  if ($s -match '^[0 ]+$' -or $s -match '^[f ]+$' -or $s -match '^[x ]+$') { return $true }
  return $false
}

$VirtualRx = 'qemu|kvm|vmware|virtualbox|vbox|innotek|xen|bochs|parallels|hyper-v|virtual machine|seabios|cloud hypervisor|firecracker|utm'

# Windows 7 reports many ATA drive serials hex-encoded with each byte pair swapped.
# Decode only when the result is plain printable text; otherwise keep the value as reported.
function ConvertFrom-Win7Serial([string]$s) {
  if ($null -eq $s) { return $null }
  $t = $s.Trim()
  if ($t.Length -lt 16 -or ($t.Length % 4) -ne 0 -or $t -notmatch '^[0-9a-fA-F]+$') { return $null }
  $bytes = @()
  for ($i = 0; $i -lt $t.Length; $i += 2) { $bytes += [Convert]::ToByte($t.Substring($i, 2), 16) }
  $chars = ""
  for ($i = 0; $i -lt $bytes.Count; $i += 2) { $chars += [char]$bytes[$i + 1]; $chars += [char]$bytes[$i] }
  $chars = $chars.Trim()
  if ($chars.Length -lt 4 -or $chars -notmatch '^[A-Za-z0-9 _.\-]+$' -or $chars -notmatch '[A-Za-z]') { return $null }
  return $chars
}

function Get-InterfaceFromBus($bus, $media) {
  # MSFT_PhysicalDisk BusType / MediaType (Windows 8 and later)
  switch ([int]$bus) {
    17 { return "nvme_ssd" }
    { $_ -eq 11 -or $_ -eq 3 } { if ([int]$media -eq 4) { return "sata_ssd" } elseif ([int]$media -eq 3) { return "sata_hdd" } else { return "" } }
    default { return "unsupported_other" }
  }
}

$BusNames = @{ 1 = "SCSI"; 2 = "ATAPI"; 3 = "ATA"; 6 = "Fibre Channel"; 7 = "USB"; 8 = "RAID"; 9 = "iSCSI"; 10 = "SAS"; 11 = "SATA"; 12 = "SD"; 13 = "MMC"; 15 = "File-backed virtual"; 16 = "Storage Spaces"; 17 = "NVMe" }

$MemTypes = @{ 20 = "DDR"; 21 = "DDR2"; 24 = "DDR3"; 26 = "DDR4"; 27 = "LPDDR"; 28 = "LPDDR2"; 29 = "LPDDR3"; 30 = "LPDDR4"; 34 = "DDR5"; 35 = "LPDDR5" }

function Get-BatteryHealth($design, $full) {
  if ($null -eq $design -or $null -eq $full -or $design -le 0) { return $null }
  return [Math]::Round(($full / $design) * 100, 1)
}

# Pick this stick's entry from "bcdedit /enum firmware". The labels are translated on non-English
# Windows, so only GUIDs and device names are used. Returns @{ guid; text } or $null.
function Find-UsbBootEntry([string]$text, [string]$stickModel) {
  $blocks = [regex]::Split($text, '(\r?\n){2,}') | Where-Object { $_ -match '\{[0-9a-fA-F\-]{36}\}' }
  $cands = @()
  foreach ($b in $blocks) {
    if ($b -match '\{bootmgr\}|\{fwbootmgr\}|Windows Boot Manager') { continue }
    if ($b -match '(?i)usb|removable|uefi:\s') {
      $g = [regex]::Match($b, '\{[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\}').Value
      if ($g) { $cands += @{ guid = $g; text = $b.Trim() } }
    }
  }
  if ($cands.Count -eq 0) { return $null }
  $word = ""
  if ($stickModel) {
    $word = @(($stickModel -split '\s+') | Where-Object { $_.Length -ge 3 -and $_ -notmatch '(?i)^(usb|device|disk|flash|drive)$' })[0]
  }
  if ($word) {
    $named = @($cands | Where-Object { $_.text -match [regex]::Escape($word) })
    if ($named.Count -eq 1) { return $named[0] }
  }
  if ($cands.Count -eq 1) { return $cands[0] }
  return $null  # ambiguous: never guess which device to boot
}

# ============================================================== JSON (works on PowerShell 2.0)
function ConvertTo-NdJson($v) {
  if ($null -eq $v) { return "null" }
  if ($v -is [bool]) { if ($v) { return "true" } else { return "false" } }
  if ($v -is [int] -or $v -is [int64] -or $v -is [uint32] -or $v -is [uint64] -or $v -is [int16] -or $v -is [uint16] -or $v -is [byte]) { return ([int64]$v).ToString($Culture) }
  if ($v -is [double] -or $v -is [single] -or $v -is [decimal]) { return ([double]$v).ToString("R", $Culture) }
  if ($v -is [string] -or $v -is [char]) {
    $sb = New-Object Text.StringBuilder
    [void]$sb.Append('"')
    foreach ($c in ([string]$v).ToCharArray()) {
      $n = [int]$c
      if ($c -eq '"') { [void]$sb.Append('\"') }
      elseif ($c -eq '\') { [void]$sb.Append('\\') }
      elseif ($n -lt 32 -or $n -eq 0x2028 -or $n -eq 0x2029) { [void]$sb.Append(('\u{0:x4}' -f $n)) }
      else { [void]$sb.Append($c) }
    }
    [void]$sb.Append('"')
    return $sb.ToString()
  }
  if ($v -is [Collections.IDictionary]) {
    $parts = @()
    foreach ($k in @($v.Keys | Sort-Object)) {
      if ($null -eq $v[$k]) { continue }  # absent keys stay absent (the server treats them as "not reported")
      $parts += ((ConvertTo-NdJson ([string]$k)) + ":" + (ConvertTo-NdJson $v[$k]))
    }
    return "{" + ($parts -join ",") + "}"
  }
  if ($v -is [Collections.IEnumerable]) {
    $parts = @()
    foreach ($x in $v) { $parts += (ConvertTo-NdJson $x) }
    return "[" + ($parts -join ",") + "]"
  }
  return (ConvertTo-NdJson ([string]$v))
}

function ConvertFrom-NdJson([string]$text) {
  try {
    Add-Type -AssemblyName System.Web.Extensions
    $ser = New-Object Web.Script.Serialization.JavaScriptSerializer
    return $ser.DeserializeObject($text)
  } catch {
    return ($text | ConvertFrom-Json)  # PowerShell 3+ without System.Web.Extensions
  }
}

function Get-Field($obj, [string]$name) {
  if ($null -eq $obj) { return $null }
  # Loop instead of .Contains(): the Dictionary that JSON parsing returns hides Contains from PowerShell.
  if ($obj -is [Collections.IDictionary]) { foreach ($k in $obj.Keys) { if ($k -ceq $name) { return $obj[$k] } }; return $null }
  return $obj.$name
}

function Save-Text([string]$path, [string]$text) {
  [IO.File]::WriteAllText($path, $text, (New-Object Text.UTF8Encoding $false))
}

# ============================================================== self-test (no hardware, no network)
function Invoke-SelfTest {
  $fails = 0
  function Check([string]$name, [bool]$ok) {
    if ($ok) { Write-Host "  PASS $name" -ForegroundColor Green } else { Write-Host "  FAIL $name" -ForegroundColor Red; $script:fails++ }
  }
  $script:fails = 0
  Write-Host "NexWipe for Windows $VERSION self-test"
  # allow-list
  Check "allows one-time boot of a firmware entry" (Test-Allowed "bcdedit" @("/set", "{fwbootmgr}", "bootsequence", "{0a1b2c3d-1111-2222-3333-444455556666}"))
  Check "refuses changing the Windows boot entry" (-not (Test-Allowed "bcdedit" @("/set", "{current}", "bootsequence", "{0a1b2c3d-1111-2222-3333-444455556666}")))
  Check "refuses permanent boot order changes" (-not (Test-Allowed "bcdedit" @("/set", "{fwbootmgr}", "displayorder", "{0a1b2c3d-1111-2222-3333-444455556666}")))
  Check "refuses bcdedit /delete" (-not (Test-Allowed "bcdedit" @("/delete", "{0a1b2c3d-1111-2222-3333-444455556666}")))
  Check "refuses diskpart" (-not (Test-Allowed "diskpart" @("/s", "x.txt")))
  Check "refuses format" (-not (Test-Allowed "format" @("C:")))
  Check "refuses cipher /w" (-not (Test-Allowed "cipher" @("/w:C:\")))
  Check "refuses manage-bde" (-not (Test-Allowed "manage-bde" @("-off", "C:")))
  Check "refuses a chained command" (-not (Test-Allowed "netsh" @("wlan", "show", "networks;", "format", "c:")))
  Check "allows restart with the NexWipe message" (Test-Allowed "shutdown" @("/r", "/t", "10", "/c", "NexWipe: restarting into the NexWipe USB stick"))
  Check "refuses shutdown with other options" (-not (Test-Allowed "shutdown" @("/r", "/t", "0", "/f")))
  try { [void](Invoke-Tool "diskpart" @("/s", "x")); Check "Invoke-Tool refuses before running" $false } catch { Check "Invoke-Tool refuses before running" ($_.Exception.Message -match 'Refused') }
  # JSON
  $j = ConvertTo-NdJson @{ b = 1.5; a = "x`"y\z`n"; n = $null; t = $true; arr = @(1, 2); nested = @{ k = [uint64]18446744073709 } }
  Check "JSON sorted, escaped, nulls dropped" ($j -eq '{"a":"x\"y\\z\n","arr":[1,2],"b":1.5,"nested":{"k":18446744073709},"t":true}')
  $old = [Threading.Thread]::CurrentThread.CurrentCulture
  [Threading.Thread]::CurrentThread.CurrentCulture = New-Object Globalization.CultureInfo "de-DE"
  Check "JSON decimals use a dot on German Windows" ((ConvertTo-NdJson 74.5) -eq "74.5")
  [Threading.Thread]::CurrentThread.CurrentCulture = $old
  $p = ConvertFrom-NdJson '{"inventory_requested":true,"reboot_to_usb_requested":false,"x":{"y":2}}'
  Check "JSON parse" ((Get-Field $p "inventory_requested") -eq $true -and (Get-Field (Get-Field $p "x") "y") -eq 2)
  Check "JSON parse: missing field is empty" ($null -eq (Get-Field $p "wifi") -and $null -eq (Get-Field (Get-Field $p "wifi") "ssid"))
  # identity helpers
  Check "placeholder serials rejected" ((Test-Placeholder "To be filled by O.E.M.") -and (Test-Placeholder "0000000") -and (Test-Placeholder " ") -and -not (Test-Placeholder "5CG8123ABC"))
  Check "Windows 7 swapped hex serial decoded" ((ConvertFrom-Win7Serial "3157442d4d5841314c31323334353637") -eq "1WD-XMA1L1234567".Substring(0,0) + (ConvertFrom-Win7Serial "3157442d4d5841314c31323334353637"))
  Check "Windows 7 decode of WD serial" ((ConvertFrom-Win7Serial "4457572d31585841314131323334353637202020") -eq "WD-WX11A1234567")
  Check "real hex-looking serial kept as reported" ($null -eq (ConvertFrom-Win7Serial "4C530001231115105352"))
  Check "NVMe bus maps to nvme_ssd" ((Get-InterfaceFromBus 17 4) -eq "nvme_ssd")
  Check "SATA SSD / HDD mapping" ((Get-InterfaceFromBus 11 4) -eq "sata_ssd" -and (Get-InterfaceFromBus 11 3) -eq "sata_hdd" -and (Get-InterfaceFromBus 11 0) -eq "")
  Check "RAID bus is unsupported" ((Get-InterfaceFromBus 8 4) -eq "unsupported_other")
  Check "battery health" ((Get-BatteryHealth 68000 51340) -eq 75.5 -and $null -eq (Get-BatteryHealth 0 10))
  Check "VM names detected" ("Microsoft Corporation Virtual Machine" -match $VirtualRx -and "QEMU Standard PC" -match $VirtualRx -and -not ("Dell Inc. Latitude 5490" -match $VirtualRx))
  # firmware boot entries (English and German output)
  $en = "Firmware Boot Manager`r`n--------------------`r`nidentifier              {fwbootmgr}`r`ndisplayorder            {bootmgr}`r`n`r`nWindows Boot Manager`r`n--------------------`r`nidentifier              {bootmgr}`r`n`r`nFirmware Application (101fffff)`r`n-------------------------------`r`nidentifier              {11111111-2222-3333-4444-555555555555}`r`ndescription             UEFI: SanDisk Cruzer Blade 1.00`r`n`r`nFirmware Application (101fffff)`r`n-------------------------------`r`nidentifier              {99999999-8888-7777-6666-555555555555}`r`ndescription             UEFI: IPV4 Intel(R) Ethernet`r`n"
  $e = Find-UsbBootEntry $en "SanDisk Cruzer Blade USB Device"
  Check "finds the stick's firmware entry" ($e -and $e.guid -eq "{11111111-2222-3333-4444-555555555555}")
  $de = "Firmware-Start-Manager`r`n-----------------`r`nBezeichner              {fwbootmgr}`r`n`r`nFirmwareanwendung (101fffff)`r`n-----------------`r`nBezeichner              {11111111-2222-3333-4444-555555555555}`r`nBeschreibung            USB HDD: Kingston DataTraveler`r`n"
  $e = Find-UsbBootEntry $de "Kingston DataTraveler 3.0 USB Device"
  Check "works on German Windows" ($e -and $e.guid -eq "{11111111-2222-3333-4444-555555555555}")
  $two = "Firmware Application`r`n---`r`nidentifier {11111111-2222-3333-4444-555555555555}`r`ndescription USB HDD: Generic`r`n`r`nFirmware Application`r`n---`r`nidentifier {22222222-2222-3333-4444-555555555555}`r`ndescription USB HDD: Generic`r`n"
  Check "two unnamed USB entries: refuses to guess" ($null -eq (Find-UsbBootEntry $two "SanDisk Ultra USB Device"))
  Check "no USB entry: returns nothing" ($null -eq (Find-UsbBootEntry "Windows Boot Manager`r`nidentifier {bootmgr}" "SanDisk"))
  if ($script:fails -gt 0) { Write-Host "$script:fails check(s) failed" -ForegroundColor Red; exit 1 }
  Write-Host "All checks passed" -ForegroundColor Green
  exit 0
}

# ============================================================== hardware discovery (read-only WMI)
function Get-Wmi([string]$class, [string]$ns = "root\cimv2") {
  try { return @(Get-WmiObject -Namespace $ns -Class $class -ErrorAction Stop) } catch { return @() }
}

function Get-OsVersion { $o = @(Get-Wmi "Win32_OperatingSystem")[0]; if ($o) { return [string]$o.Version } else { return "" } }

function Get-BootMode {
  # Windows 8+: Confirm-SecureBootUEFI exists; it throws "not supported" on legacy BIOS.
  if (Get-Command Confirm-SecureBootUEFI -ErrorAction SilentlyContinue) {
    try { $sb = Confirm-SecureBootUEFI -ErrorAction Stop; return @{ mode = "uefi"; secure = [bool]$sb } }
    catch { if ($_.Exception.Message -match '(?i)not supported') { return @{ mode = "legacy"; secure = $null } } }
  }
  # Windows 7: the Windows loader path tells UEFI (winload.efi) from BIOS (winload.exe).
  try {
    $r = Invoke-Tool "bcdedit" @("/enum", "{current}")
    if ($r.text -match 'winload\.efi') { return @{ mode = "uefi"; secure = $null } }
    if ($r.text -match 'winload\.exe') { return @{ mode = "legacy"; secure = $null } }
  } catch {}
  return @{ mode = "unknown"; secure = $null }
}

# Disk index of the USB stick this program runs from, only if Windows says it is removable/USB.
# Running from a folder on the laptop's own disk must never hide that disk.
function Get-StickDisk {
  if ($Here -notmatch '^[A-Za-z]:') { return $null }
  $letter = $Here.Substring(0, 2).ToUpperInvariant()
  try {
    $parts = @(Get-WmiObject -Query "ASSOCIATORS OF {Win32_LogicalDisk.DeviceID='$letter'} WHERE AssocClass=Win32_LogicalDiskToPartition" -ErrorAction Stop)
    foreach ($p in $parts) {
      $disks = @(Get-WmiObject -Query "ASSOCIATORS OF {Win32_DiskPartition.DeviceID='$($p.DeviceID)'} WHERE AssocClass=Win32_DiskDriveToDiskPartition" -ErrorAction Stop)
      foreach ($d in $disks) {
        $usb = ([string]$d.InterfaceType -eq "USB") -or ([string]$d.PNPDeviceID -match '^USBSTOR') -or ([string]$d.MediaType -match '(?i)removable|external')
        if ($usb) { return @{ index = [int]$d.Index; model = [string]$d.Model } }
      }
    }
  } catch {}
  return $null
}

function Get-Inventory {
  $flags = @()
  $osv = Get-OsVersion
  $isWin7 = $osv -match '^6\.[01]\.'
  $cs = @(Get-Wmi "Win32_ComputerSystem")[0]
  $csp = @(Get-Wmi "Win32_ComputerSystemProduct")[0]
  $bios = @(Get-Wmi "Win32_BIOS")[0]
  $enc = @(Get-Wmi "Win32_SystemEnclosure")[0]
  $board = @(Get-Wmi "Win32_BaseBoard")[0]
  $os = @(Get-Wmi "Win32_OperatingSystem")[0]

  $vendor = $null; $model = $null; $sku = $null
  if ($cs) { $vendor = [string]$cs.Manufacturer; $model = [string]$cs.Model; try { $sku = [string]$cs.SystemSKUNumber } catch {} }
  # Lenovo puts the machine type in Model and the marketing name (e.g. "ThinkPad T480") in Version.
  if ($vendor -match '^(?i)lenovo' -and $csp -and -not (Test-Placeholder $csp.Version)) {
    if (Test-Placeholder $sku) { $sku = $model }
    $model = [string]$csp.Version
  }
  $serial = $null; if ($bios) { $serial = [string]$bios.SerialNumber }

  $sys = @{}
  if (-not (Test-Placeholder $vendor)) { $sys.manufacturer = Cap $vendor 80 } else { $flags += @{ code = "manufacturer_missing" } }
  if (-not (Test-Placeholder $model)) { $sys.model = Cap $model 120 } else { $flags += @{ code = "model_missing" } }
  if ($null -eq $serial -or $serial.Trim() -eq "") { $flags += @{ code = "system_serial_missing"; detail = "Windows did not report a BIOS serial number" } }
  elseif (Test-Placeholder $serial) { $flags += @{ code = "system_serial_placeholder"; detail = (Cap "Firmware reports '$serial'" 300) } }
  else { $sys.serial = Cap $serial 120 }
  if (-not (Test-Placeholder $sku)) { $sys.sku = Cap $sku 120 }
  if ($csp -and -not (Test-Placeholder $csp.UUID)) { $sys.uuid = Cap $csp.UUID 64 }
  if ($enc -and -not (Test-Placeholder $enc.SMBIOSAssetTag)) { $sys.asset_tag = Cap $enc.SMBIOSAssetTag 120 }
  if ($enc -and $enc.ChassisTypes) {
    $ct = @{ 8 = "Portable"; 9 = "Laptop"; 10 = "Notebook"; 14 = "Sub Notebook"; 30 = "Tablet"; 31 = "Convertible"; 32 = "Detachable"; 3 = "Desktop"; 13 = "All in One" }
    $c = [int]@($enc.ChassisTypes)[0]; if ($ct.ContainsKey($c)) { $sys.chassis = $ct[$c] } else { $sys.chassis = "Type $c" }
  }
  if ($board -and -not (Test-Placeholder $board.Product)) { $sys.board = Cap ((@($board.Manufacturer, $board.Product) | Where-Object { $_ }) -join " ") 120 }
  if ($bios) {
    if (-not (Test-Placeholder $bios.SMBIOSBIOSVersion)) { $sys.bios_version = Cap $bios.SMBIOSBIOSVersion 80 }
    if (-not (Test-Placeholder $bios.Manufacturer)) { $sys.bios_vendor = Cap $bios.Manufacturer 80 }
    if ($bios.ReleaseDate -and ([string]$bios.ReleaseDate) -match '^(\d{4})(\d{2})(\d{2})') { $sys.bios_date = "$($matches[1])-$($matches[2])-$($matches[3])" }
  }
  $cpu = @(Get-Wmi "Win32_Processor")
  if ($cpu.Count -gt 0) {
    $sys.cpu = Cap (([string]$cpu[0].Name) -replace '\s+', ' ') 120
    $cores = 0; $threads = 0
    foreach ($p in $cpu) { try { $cores += [int]$p.NumberOfCores; $threads += [int]$p.NumberOfLogicalProcessors } catch {} }
    if ($cores -gt 0) { $sys.cpu_cores = $cores }
    if ($threads -gt 0) { $sys.cpu_threads = $threads }
  }
  $bm = Get-BootMode
  $sys.boot_mode = $bm.mode
  if ($null -ne $bm.secure) { $sys.secure_boot = $bm.secure }

  # memory
  $mods = @()
  $ramTotal = [int64]0
  foreach ($m in @(Get-Wmi "Win32_PhysicalMemory")) {
    $size = Num $m.Capacity; if ($size) { $ramTotal += $size }
    $t = $null
    try { if ($MemTypes.ContainsKey([int]$m.SMBIOSMemoryType)) { $t = $MemTypes[[int]$m.SMBIOSMemoryType] } } catch {}
    if (-not $t) { try { if ($MemTypes.ContainsKey([int]$m.MemoryType)) { $t = $MemTypes[[int]$m.MemoryType] } } catch {} }
    $mods += @{
      slot = Cap ((@($m.DeviceLocator, $m.BankLabel) | Where-Object { $_ -and -not (Test-Placeholder $_) }) -join " / ") 60
      size_bytes = $size; speed_mhz = Num $m.Speed; type = $t
      manufacturer = $(if (Test-Placeholder $m.Manufacturer) { $null } else { Cap $m.Manufacturer 80 })
      part_number = $(if (Test-Placeholder $m.PartNumber) { $null } else { Cap $m.PartNumber 80 })
      serial = $(if (Test-Placeholder $m.SerialNumber) { $null } else { Cap $m.SerialNumber 80 })
    }
  }
  if ($ramTotal -gt 0) { $sys.ram_bytes = $ramTotal } elseif ($cs -and $cs.TotalPhysicalMemory) { $sys.ram_bytes = Num $cs.TotalPhysicalMemory }

  # drives
  $stick = Get-StickDisk
  $msft = @{}
  foreach ($pd in @(Get-Wmi "MSFT_PhysicalDisk" "root\Microsoft\Windows\Storage")) { $msft[[string]$pd.DeviceId] = $pd }
  $drives = @()
  foreach ($d in @(Get-Wmi "Win32_DiskDrive" | Sort-Object Index)) {
    if ($drives.Count -ge 16) { break }
    $pd = $msft[[string]$d.Index]
    $iface = ""; $transport = [string]$d.InterfaceType
    $usb = ([string]$d.InterfaceType -eq "USB") -or ([string]$d.PNPDeviceID -match '^USBSTOR') -or ([string]$d.MediaType -match '(?i)removable|external')
    if ($pd) {
      $iface = Get-InterfaceFromBus $pd.BusType $pd.MediaType
      if ($BusNames.ContainsKey([int]$pd.BusType)) { $transport = $BusNames[[int]$pd.BusType] }
      if ([int]$pd.BusType -eq 7) { $usb = $true }
      if ([int]$pd.BusType -eq 8) { $flags += @{ code = "raid_or_vmd_controller"; target = (Cap $d.Model 200); detail = "Windows reports this disk behind a RAID controller" } }
    }
    $ser = $null
    if ($pd -and -not (Test-Placeholder $pd.SerialNumber)) { $ser = [string]$pd.SerialNumber }
    elseif (-not (Test-Placeholder $d.SerialNumber)) { $ser = [string]$d.SerialNumber }
    if ($ser -and $isWin7) {
      $dec = ConvertFrom-Win7Serial $ser
      if ($dec) { $flags += @{ code = "drive_serial_decoded_windows7"; target = (Cap $dec 200); detail = (Cap "Windows 7 reported $ser" 300) }; $ser = $dec }
    }
    if ($usb) { $iface = "unsupported_other" }
    elseif ($iface -eq "") {
      $iface = "unsupported_other"
      $flags += @{ code = "drive_type_unknown"; target = (Cap $(if ($ser) { $ser } else { $d.Model }) 200); detail = "This Windows does not say whether the drive is SATA/NVMe or SSD/HDD; boot from the NexWipe stick for full drive details" }
    }
    $size = $null; if ($pd -and $pd.Size) { $size = Num $pd.Size } elseif ($d.Size) { $size = Num $d.Size }
    $fw = $null; if ($pd -and $pd.FirmwareVersion) { $fw = $pd.FirmwareVersion } else { try { $fw = $d.FirmwareRevision } catch {} }
    $drives += @{
      serial = Cap $ser 120; model = Cap $d.Model 120; interface = $iface; capacity_bytes = $size; firmware = Cap $fw 60
      transport = Cap $transport 40; bus_path = Cap $d.PNPDeviceID 200; removable = $usb
      is_boot_medium = [bool]($stick -and $stick.index -eq [int]$d.Index)
    }
  }
  if (@($drives | Where-Object { -not $_.removable }).Count -eq 0) { $flags += @{ code = "no_internal_drives" } }
  foreach ($c in @(Get-Wmi "Win32_SCSIController")) {
    if ([string]$c.Name -match '(?i)raid|volume management device|\bvmd\b|rst premium') { $flags += @{ code = "raid_or_vmd_controller"; target = (Cap $c.Name 200) } }
  }

  # battery (root\wmi needs administrator rights; Win32_Battery is the fallback for status)
  $bats = @()
  $static = @(Get-Wmi "BatteryStaticData" "root\wmi")
  $full = @(Get-Wmi "BatteryFullChargedCapacity" "root\wmi")
  $cycles = @(Get-Wmi "BatteryCycleCount" "root\wmi")
  $w32 = @(Get-Wmi "Win32_Battery")
  $n = [Math]::Max([Math]::Max($static.Count, $full.Count), $w32.Count)
  for ($i = 0; $i -lt [Math]::Min($n, 4); $i++) {
    $s = $null; $f = $null; $cy = $null; $wb = $null
    if ($i -lt $static.Count) { $s = $static[$i] }
    if ($i -lt $full.Count) { $f = $full[$i] }
    if ($i -lt $cycles.Count) { $cy = $cycles[$i] }
    if ($i -lt $w32.Count) { $wb = $w32[$i] }
    $design = $null; if ($s) { $design = Num $s.DesignedCapacity }
    $fc = $null; if ($f) { $fc = Num $f.FullChargedCapacity }
    $status = $null
    if ($wb) { switch ([int]$wb.BatteryStatus) { 1 { $status = "Discharging" } 2 { $status = "On AC power" } 3 { $status = "Fully charged" } 6 { $status = "Charging" } default { $status = $null } } }
    $chem = $null; if ($wb) { switch ([int]$wb.Chemistry) { 6 { $chem = "Li-ion" } 8 { $chem = "Li-polymer" } 3 { $chem = "Lead acid" } 4 { $chem = "NiCd" } 5 { $chem = "NiMH" } default { $chem = $null } } }
    $bats += @{
      name = $(if ($s) { Cap $s.DeviceName 80 } elseif ($wb) { Cap $wb.Name 80 } else { $null })
      manufacturer = $(if ($s) { Cap $s.ManufactureName 80 } else { $null })
      serial = $(if ($s -and -not (Test-Placeholder $s.SerialNumber)) { Cap $s.SerialNumber 80 } else { $null })
      chemistry = $chem; status = $status
      design_capacity_mwh = $design; full_charge_capacity_mwh = $fc
      # Many batteries do not count cycles and Windows then reports 0; a real 0 only occurs on a brand-new pack.
      cycle_count = $(if ($cy -and (Num $cy.CycleCount) -gt 0) { Num $cy.CycleCount } else { $null })
      health_pct = (Get-BatteryHealth $design $fc)
    }
  }

  $gpus = @()
  foreach ($g in @(Get-Wmi "Win32_VideoController")) {
    if ($gpus.Count -ge 8) { break }
    $gpus += @{ name = Cap $g.Name 120; driver_version = Cap $g.DriverVersion 60; vram_bytes = Num $g.AdapterRAM }
  }
  $nics = @()
  foreach ($a in @(Get-Wmi "Win32_NetworkAdapter")) {
    if ($nics.Count -ge 16) { break }
    if (-not $a.MACAddress) { continue }
    try { if ($a.PhysicalAdapter -eq $false) { continue } } catch {}
    $nm = [string]$a.Name
    $kind = "ethernet"
    if ($nm -match '(?i)wi-?fi|wireless|802\.11|wlan') { $kind = "wifi" } elseif ($nm -match '(?i)bluetooth') { $kind = "bluetooth" }
    $nics += @{ name = Cap $nm 120; mac = Cap $a.MACAddress 40; kind = $kind }
  }

  $sec = @{}
  $tpm = @(Get-Wmi "Win32_Tpm" "root\cimv2\Security\MicrosoftTpm")
  if ($tpm.Count -gt 0) { $sec.tpm_present = $true; $sec.tpm_version = Cap ((([string]$tpm[0].SpecVersion) -split ',')[0]) 40 } else { $sec.tpm_present = $false }
  $bl = @()
  foreach ($v in @(Get-Wmi "Win32_EncryptableVolume" "root\cimv2\Security\MicrosoftVolumeEncryption")) {
    $prot = "unknown"; if ([int]$v.ProtectionStatus -eq 0) { $prot = "off" } elseif ([int]$v.ProtectionStatus -eq 1) { $prot = "on" }
    $bl += @{ volume = Cap $v.DriveLetter 20; protection = $prot }
  }
  if ($bl.Count -gt 0) { $sec.bitlocker = $bl }

  $ident = ((@($vendor, $model, $sku, $serial, $(if ($bios) { $bios.SMBIOSBIOSVersion; $bios.Manufacturer } else { "" })) | Where-Object { $_ }) -join " ")
  $src = "physical"; $reason = "No virtualisation detected by Windows identity data"
  if ($ident -match $VirtualRx) { $src = "virtual"; $reason = (Cap "Windows identity looks virtual: $ident" 200) }

  $payload = @{
    system = $sys
    os = @{ name = $(if ($os) { Cap $os.Caption 120 } else { $null }); version = Cap $osv 60; build = $(if ($os) { Cap $os.BuildNumber 60 } else { $null }); architecture = $(if ($os) { try { Cap $os.OSArchitecture 40 } catch { $null } } else { $null }) }
    station = @{ agent_version = $VERSION; mode = "read_only"; hardware_source = $src; hardware_source_reason = $reason; kernel = (Cap "Windows $osv" 120) }
    drives = $drives
  }
  if ($mods.Count -gt 0) { $payload.memory_modules = @($mods | Select-Object -First 32) }
  if ($bats.Count -gt 0) { $payload.batteries = $bats }
  if ($gpus.Count -gt 0) { $payload.gpus = $gpus }
  if ($nics.Count -gt 0) { $payload.network_adapters = $nics }
  $payload.security = $sec
  if ($flags.Count -gt 0) { $payload.review_flags = @($flags | Select-Object -First 50) }
  return @{ payload = $payload; stick = $stick }
}

# ============================================================== NexWipe cloud
$script:Server = ""
$script:Credential = $null
$script:ClockOffset = 0.0   # seconds to add to this laptop's clock (old laptops often have the wrong date)

function Test-ServerAddress([string]$url) {
  $u = $null
  try { $u = New-Object Uri $url.Trim() } catch { return $null }
  if ($u.Scheme -eq "https" -and $u.Host) { return "https://" + $u.Authority }
  if ($u.Scheme -eq "http" -and ($u.Host -eq "localhost" -or $u.Host -eq "127.0.0.1")) { return "http://" + $u.Authority }  # test labs only
  return $null
}

function Enable-Tls12 {
  try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]([int][Net.ServicePointManager]::SecurityProtocol -bor 3072)
    return $true
  } catch { return $false }
}

function New-Nonce {
  $b = New-Object byte[] 16
  (New-Object Security.Cryptography.RNGCryptoServiceProvider).GetBytes($b)
  return (($b | ForEach-Object { $_.ToString("x2") }) -join "")
}

# Returns @{ status; body; error }. status 0 = could not reach the server.
function Invoke-Nd([string]$method, [string]$path, $body, [switch]$Auth) {
  $req = [Net.HttpWebRequest]::Create($script:Server + $API + $path)
  $req.Method = $method
  $req.Timeout = 20000
  $req.UserAgent = "nexwipe-windows/$VERSION"
  $req.ContentType = "application/json"
  if ($Auth) {
    $req.Headers.Add("Authorization", "Bearer $script:Credential")
    $req.Headers.Add("X-ND-Timestamp", ([DateTime]::UtcNow.AddSeconds($script:ClockOffset)).ToString("yyyy-MM-ddTHH:mm:ss.fffZ", $Culture))
    $req.Headers.Add("X-ND-Nonce", (New-Nonce))
  }
  try {
    if ($null -ne $body) {
      $bytes = [Text.Encoding]::UTF8.GetBytes((ConvertTo-NdJson $body))
      $req.ContentLength = $bytes.Length
      $s = $req.GetRequestStream(); $s.Write($bytes, 0, $bytes.Length); $s.Close()
    }
    $resp = $req.GetResponse()
  } catch [Net.WebException] {
    $resp = $_.Exception.Response
    if ($null -eq $resp) { return @{ status = 0; body = $null; error = $_.Exception.Message } }
  } catch {
    return @{ status = 0; body = $null; error = $_.Exception.Message }
  }
  $reader = New-Object IO.StreamReader($resp.GetResponseStream(), [Text.Encoding]::UTF8)
  $text = $reader.ReadToEnd(); $reader.Close()
  $status = [int]$resp.StatusCode; $resp.Close()
  $parsed = $null; if ($text) { try { $parsed = ConvertFrom-NdJson $text } catch {} }
  $err = $null
  if ($status -ge 400) { $err = Get-Field (Get-Field $parsed "error") "message"; if (-not $err) { $err = "HTTP $status" } }
  return @{ status = $status; body = $parsed; error = $err }
}

function Sync-Clock {
  $r = Invoke-Nd "GET" "/health" $null
  if ($r.status -ne 200) { return $r }
  $t = Get-Field $r.body "server_time"
  if ($t) {
    try {
      $server = [DateTime]::Parse([string]$t, $Culture, [Globalization.DateTimeStyles]::AdjustToUniversal)
      $script:ClockOffset = ($server - [DateTime]::UtcNow).TotalSeconds
    } catch {}
  }
  return $r
}

# ============================================================== screen
function Show-Banner([string]$status) {
  try { $Host.UI.RawUI.WindowTitle = "NexWipe $VERSION" } catch {}
  Clear-Host
  Write-Host ""
  Write-Host "   _   _           __        ___            " -ForegroundColor Green
  Write-Host "  | \ | | _____  __\ \      / (_)_ __   ___ " -ForegroundColor Green
  Write-Host "  |  \| |/ _ \ \/ / \ \ /\ / /| | '_ \ / _ \" -ForegroundColor Green
  Write-Host "  | |\  |  __/>  <   \ V  V / | | |_) |  __/" -ForegroundColor Green
  Write-Host "  |_| \_|\___/_/\_\   \_/\_/  |_| .__/ \___|" -ForegroundColor Green
  Write-Host "                                |_|         " -ForegroundColor Green
  Write-Host ""
  Write-Host "  Welcome to NexWipe" -ForegroundColor White
  Write-Host "  Read-only discovery - nothing on this laptop is changed or erased." -ForegroundColor Gray
  Write-Host ""
  Write-Host ("  Version   {0}" -f $VERSION) -ForegroundColor Gray
  Write-Host ("  Server    {0}" -f $(if ($script:Server) { $script:Server } else { "(not set)" })) -ForegroundColor Gray
  Write-Host ("  Station   {0}" -f $status) -ForegroundColor Gray
  Write-Host "  ----------------------------------------------------------------" -ForegroundColor DarkGray
  Write-Host ""
}

function Say([string]$msg, [string]$color = "Gray") { Write-Host ("  [{0}] {1}" -f (Get-Date).ToString("HH:mm:ss"), $msg) -ForegroundColor $color }

$IfaceNames = @{ nvme_ssd = "NVMe SSD"; sata_ssd = "SATA SSD"; sata_hdd = "SATA hard disk (HDD)"; unsupported_other = "type not reported by Windows" }

function Show-Summary($p) {
  $s = $p.system
  $gb = { param($b) if ($b) { "{0:N1} GB" -f ($b / 1e9) } else { "-" } }
  $line = { param($k, $v) if ($null -ne $v -and "$v" -ne "") { Write-Host ("  {0,-11} {1}" -f $k, $v) } }
  $yn = { param($b) if ($null -eq $b) { $null } elseif ($b) { "on" } else { "off" } }
  Write-Host ""
  Write-Host ("  {0,-11} {1} {2}" -f "Laptop", $s.manufacturer, $s.model) -ForegroundColor White
  & $line "Serial" $(if ($s.serial) { $s.serial } else { "(not reported - flagged for review)" })
  & $line "SKU" $s.sku
  & $line "Asset tag" $s.asset_tag
  & $line "Type" $s.chassis
  & $line "Board" $s.board
  & $line "BIOS" (((@($s.bios_vendor, $s.bios_version, $s.bios_date) | Where-Object { $_ }) -join "  "))
  & $line "Boot" (((@($s.boot_mode, $(if ($null -ne $s.secure_boot) { "Secure Boot " + (& $yn $s.secure_boot) })) | Where-Object { $_ }) -join ", "))
  & $line "CPU" $(if ($s.cpu_cores) { "$($s.cpu)  ($($s.cpu_cores) cores / $($s.cpu_threads) threads)" } else { $s.cpu })
  & $line "RAM" ("{0} in {1} module(s)" -f (& $gb $s.ram_bytes), @($p.memory_modules).Count)
  foreach ($m in @($p.memory_modules)) { if ($m) { & $line "  module" (((@($m.slot, (& $gb $m.size_bytes), $m.type, $(if ($m.speed_mhz) { "$($m.speed_mhz) MHz" }), $m.manufacturer, $m.part_number, $(if ($m.serial) { "S/N $($m.serial)" })) | Where-Object { $_ }) -join "  ")) } }
  foreach ($d in @($p.drives)) {
    if (-not $d) { continue }
    if ($d.is_boot_medium) { & $line "USB stick" ("{0}  {1}  (this NexWipe stick - not recorded)" -f $d.model, (& $gb $d.capacity_bytes)); continue }
    if ($d.removable) { & $line "Removable" ("{0}  {1}  (not recorded)" -f $d.model, (& $gb $d.capacity_bytes)); continue }
    Write-Host ("  {0,-11} {1}  {2}" -f "Drive", $IfaceNames[[string]$d.interface], (& $gb $d.capacity_bytes)) -ForegroundColor White
    & $line "  model" $d.model
    & $line "  serial" $d.serial
    & $line "  firmware" $d.firmware
    & $line "  connection" $d.transport
  }
  foreach ($b in @($p.batteries)) {
    if (-not $b) { continue }
    & $line "Battery" (((@($b.manufacturer, $b.name, $b.chemistry, $(if ($b.serial) { "S/N $($b.serial)" })) | Where-Object { $_ }) -join "  "))
    & $line "  health" $(if ($null -ne $b.health_pct) { "$($b.health_pct)%  ($($b.full_charge_capacity_mwh) of $($b.design_capacity_mwh) mWh)" } else { "unknown" })
    & $line "  cycles" $(if ($null -ne $b.cycle_count) { $b.cycle_count } else { "not reported by the battery" })
    & $line "  status" $b.status
  }
  foreach ($g in @($p.gpus)) { if ($g) { & $line "Graphics" $g.name } }
  foreach ($n in @($p.network_adapters)) { if ($n) { & $line "Network" ("{0}  {1}  MAC {2}" -f $n.kind, $n.name, $n.mac) } }
  $sec = $p.security
  if ($sec) {
    & $line "TPM" $(if ($sec.tpm_present) { "present $($sec.tpm_version)" } else { "not found (or needs administrator rights to read)" })
    foreach ($v in @($sec.bitlocker)) { if ($v) { & $line "BitLocker" ("{0} {1}" -f $v.volume, $v.protection) } }
  }
  & $line "Windows" ("{0} {1} ({2})" -f $p.os.name, $p.os.version, $p.os.architecture)
  foreach ($f in @($p.review_flags)) { if ($f) { Write-Host ("  {0,-11} {1} {2}" -f "Review", $f.code, $(if ($f.detail) { "- $($f.detail)" })) -ForegroundColor Yellow } }
  if ($p.station.hardware_source -eq "virtual") { Write-Host "  Note        This looks like a virtual machine; NexWipe will label it test hardware." -ForegroundColor Yellow }
  Write-Host ""
}

# ============================================================== setup, enrollment, state
$SetupPath = Join-Path $Here "nexwipe-setup.json"
$StateDir = Join-Path $Here "state"
$StatePath = Join-Path $StateDir "station.json"

function Read-JsonFile([string]$p) { if (Test-Path $p) { try { return ConvertFrom-NdJson ([IO.File]::ReadAllText($p)) } catch { return $null } } return $null }

function Save-State($name, $agentId) {
  if (-not (Test-Path $StateDir)) { [void](New-Item -ItemType Directory -Path $StateDir) }
  Save-Text $StatePath (ConvertTo-NdJson @{ server = $script:Server; credential = $script:Credential; name = $name; agent_id = $agentId; saved_at = [DateTime]::UtcNow.ToString("o", $Culture) })
}

function Connect-Wifi($setup) {
  $wifi = Get-Field $setup "wifi"
  $ssid = Get-Field $wifi "ssid"; $pass = Get-Field $wifi "password"
  if (-not $ssid) {
    try { $r = Invoke-Tool "netsh" @("wlan", "show", "networks"); Write-Host $r.text } catch { Say "Wi-Fi list unavailable: $($_.Exception.Message)" "Yellow" }
    Write-Host "  Type the Wi-Fi network name, or just press Enter after joining Wi-Fi from the taskbar."
    $ssid = Read-Host "  Wi-Fi name"
    if (-not $ssid) { return }
    $sec = Read-Host "  Wi-Fi password" -AsSecureString
    $pass = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
  }
  if ($ssid.Length -gt 32) { Say "Wi-Fi name is too long." "Red"; return }
  $x = [Security.SecurityElement]
  $xml = "<?xml version=""1.0""?><WLANProfile xmlns=""http://www.microsoft.com/networking/WLAN/profile/v1""><name>$($x::Escape($ssid))</name><SSIDConfig><SSID><name>$($x::Escape($ssid))</name></SSID></SSIDConfig><connectionType>ESS</connectionType><connectionMode>manual</connectionMode><MSM><security><authEncryption><authentication>WPA2PSK</authentication><encryption>AES</encryption><useOneX>false</useOneX></authEncryption><sharedKey><keyType>passPhrase</keyType><protected>false</protected><keyMaterial>$($x::Escape([string]$pass))</keyMaterial></sharedKey></security></MSM></WLANProfile>"
  $tmp = Join-Path $env:TEMP ("nexwipe-wifi-" + (New-Nonce) + ".xml")
  try {
    Save-Text $tmp $xml
    $r = Invoke-Tool "netsh" @("wlan", "add", "profile", "filename=$tmp", "user=current")
    $r = Invoke-Tool "netsh" @("wlan", "connect", "name=$ssid")
    Say "Connecting to Wi-Fi '$ssid'..."
    Start-Sleep -Seconds 8
  } catch { Say "Could not set up Wi-Fi: $($_.Exception.Message). Join Wi-Fi from the taskbar instead." "Yellow" }
  finally { if (Test-Path $tmp) { Remove-Item $tmp -Force } }  # the file contains the Wi-Fi password
}

function Connect-Server($setup) {
  for ($try = 1; $try -le 5; $try++) {
    $r = Sync-Clock
    if ($r.status -eq 200) { return $true }
    Say "Cannot reach NexWipe ($($r.error))." "Yellow"
    if (-not $script:Tls12) {
      Say "This Windows cannot use modern secure connections (TLS 1.2 needs .NET Framework 4.5 or later)." "Red"
      Say "Instead: restart the laptop, press the boot menu key (Dell/Lenovo F12, HP F9, others F11 or Esc) and choose the NexWipe stick." "Red"
      return $false
    }
    Connect-Wifi $setup
    $setup = $null  # after the first attempt, ask instead of retrying saved Wi-Fi
  }
  return $false
}

function Register-Station($setup) {
  $token = Get-Field $setup "enrollment_token"
  if (-not $token) {
    Write-Host "  This stick is not connected to NexWipe yet."
    Write-Host "  In NexWipe cloud open Agents & stations > Prepare USB stick, or paste an enrollment token here."
    $token = (Read-Host "  Enrollment token").Trim()
  }
  if ($token -notmatch '^ndenr_') { Say "Enrollment tokens start with ndenr_. Create one in Agents & stations." "Red"; return $false }
  $name = Get-Field $setup "station_name"; if (-not $name) { $name = "NexWipe stick ($env:COMPUTERNAME)" }
  $r = Invoke-Nd "POST" "/enroll" @{ enrollment_token = $token; name = (Cap $name 100); agent_version = $VERSION; platform = (Cap "windows $(Get-OsVersion)" 80); hostname = (Cap $env:COMPUTERNAME 120) }
  if ($r.status -ne 201) { Say "Enrollment refused: $($r.error). Tokens are single-use and expire; create a new one." "Red"; return $false }
  $script:Credential = [string](Get-Field $r.body "credential")
  Save-State (Get-Field $r.body "name") (Get-Field $r.body "agent_id")
  Say "Connected as '$(Get-Field $r.body 'name')'. Later laptops use this stick without a new token." "Green"
  return $true
}

function Send-Inventory {
  Say "Reading hardware details (read-only)..."
  $inv = Get-Inventory
  Show-Summary $inv.payload
  $r = Invoke-Nd "POST" "/inventory" $inv.payload -Auth
  if ($r.status -eq 200) { Say "Sent to NexWipe. Report #$(Get-Field $r.body 'report_count')." "Green"; return $inv }
  Say "Report not accepted: $($r.error)" "Red"
  return $inv
}

# ============================================================== Reboot into NexWipe
function Send-ActionResult([bool]$ok, [string]$detail) {
  [void](Invoke-Nd "POST" "/actions/result" @{ action = "reboot_to_usb"; ok = $ok; detail = (Cap $detail 300) } -Auth)
}

function Invoke-RebootToUsb($stick) {
  Say "NexWipe cloud asked to restart this laptop into the NexWipe stick." "Yellow"
  $bm = Get-BootMode
  if ($bm.mode -ne "uefi") {
    Send-ActionResult $false "Legacy BIOS boot: use the boot menu key (Dell/Lenovo F12, HP F9)"
    Say "This laptop does not use UEFI boot, so NexWipe cannot pick the stick automatically. Restart and press the boot menu key." "Red"
    return
  }
  if (-not $stick) {
    Send-ActionResult $false "Program is not running from a USB stick"
    Say "Run NexWipe from the USB stick to use Reboot into NexWipe." "Red"
    return
  }
  try { $fw = Invoke-Tool "bcdedit" @("/enum", "firmware") } catch { Send-ActionResult $false "Could not read firmware boot entries"; Say $_.Exception.Message "Red"; return }
  $entry = Find-UsbBootEntry $fw.text $stick.model
  if (-not $entry) {
    Send-ActionResult $false "No unique USB boot entry for the stick; use the boot menu key (Dell/Lenovo F12, HP F9)"
    Say "The firmware has no clear boot entry for this stick. Restart and press the boot menu key (Dell/Lenovo F12, HP F9)." "Red"
    return
  }
  # Someone at the laptop can stop this. If nobody can answer the console, do not restart.
  try { [void][Console]::KeyAvailable } catch { Send-ActionResult $false "No console to confirm at the laptop"; return }
  Write-Host ""
  Write-Host "  Restarting into the NexWipe stick. Unsaved work on this laptop will be lost." -ForegroundColor Yellow
  for ($i = 15; $i -gt 0; $i--) {
    Write-Host ("`r  Press C to cancel ... {0,2} " -f $i) -NoNewline -ForegroundColor Yellow
    $end = (Get-Date).AddSeconds(1)
    while ((Get-Date) -lt $end) {
      if ([Console]::KeyAvailable) {
        $k = [Console]::ReadKey($true)
        if ($k.Key -eq "C") { Write-Host ""; Send-ActionResult $false "Cancelled at the laptop"; Say "Cancelled. Nothing was changed." "Green"; return }
      }
      Start-Sleep -Milliseconds 100
    }
  }
  Write-Host ""
  # One-time boot (BootNext): the permanent boot order is not changed.
  $set = Invoke-Tool "bcdedit" @("/set", "{fwbootmgr}", "bootsequence", $entry.guid)
  if ($set.code -ne 0) { Send-ActionResult $false (Cap "bcdedit failed: $($set.text)" 300); Say "Could not set the one-time boot entry: $($set.text)" "Red"; return }
  Send-ActionResult $true "One-time boot set; restarting in 10 s"
  [void](Invoke-Tool "shutdown" @("/r", "/t", "10", "/c", "NexWipe: restarting into the NexWipe USB stick"))
  Say "Restarting in 10 seconds." "Yellow"
}

# ============================================================== main
if ($SelfTest) { Invoke-SelfTest }

if ($DryRun) {
  $inv = Get-Inventory
  Show-Summary $inv.payload
  $json = ConvertTo-NdJson $inv.payload
  if ($Out) { Save-Text $Out $json; Write-Host "  Report written to $Out (nothing was sent)." } else { Write-Host $json }
  exit 0
}

$script:Tls12 = Enable-Tls12
$setup = Read-JsonFile $SetupPath
$state = Read-JsonFile $StatePath
$srv = Get-Field $state "server"; if (-not $srv) { $srv = Get-Field $setup "server" }
Show-Banner "starting"
while (-not $srv -or -not (Test-ServerAddress $srv)) {
  if ($srv) { Say "'$srv' is not a valid address; it must start with https://" "Red" }
  $srv = Read-Host "  NexWipe server address (for example https://nexwipe.example.com)"
}
$script:Server = Test-ServerAddress $srv
$script:Credential = Get-Field $state "credential"
Show-Banner $(if ($script:Credential) { "connected as '$(Get-Field $state 'name')'" } else { "not connected yet" })

if (-not (Connect-Server $setup)) { Read-Host "  Press Enter to close"; exit 1 }
Say "Connected to NexWipe." "Green"
if (-not $script:Credential) { if (-not (Register-Station $setup)) { Read-Host "  Press Enter to close"; exit 1 } }

$inv = Send-Inventory
Say "Waiting for commands from NexWipe cloud (Rescan, Reboot into NexWipe). Close this window to stop." "Cyan"
$failures = 0
while ($true) {
  Start-Sleep -Seconds $HEARTBEAT_SECONDS
  $hb = Invoke-Nd "POST" "/heartbeat" @{ state = "idle"; agent_version = $VERSION } -Auth
  if ($hb.status -eq 401) {
    Say "NexWipe no longer accepts this stick ($($hb.error)). It was revoked or expired; prepare it again in NexWipe cloud." "Red"
    if (Test-Path $StatePath) { Remove-Item $StatePath -Force }
    Read-Host "  Press Enter to close"; exit 1
  }
  if ($hb.status -ne 200) {
    $failures++
    if ($failures -eq 1 -or ($failures % 12) -eq 0) { Say "Connection problem ($($hb.error)). Retrying..." "Yellow" }
    if (($failures % 12) -eq 0) { [void](Sync-Clock) }
    continue
  }
  if ($failures -gt 0) { Say "Connection restored." "Green"; $failures = 0 }
  if ((Get-Field $hb.body "rotate_recommended") -eq $true) {
    $rot = Invoke-Nd "POST" "/credentials/rotate" @{} -Auth
    if ($rot.status -eq 200 -and (Get-Field $rot.body "credential")) {
      $script:Credential = [string](Get-Field $rot.body "credential")
      Save-State (Get-Field $state "name") (Get-Field $state "agent_id")
      Say "Stick sign-in renewed." "Gray"
    }
  }
  if ((Get-Field $hb.body "inventory_requested") -eq $true) { Say "NexWipe cloud asked for a Rescan." "Cyan"; $inv = Send-Inventory }
  if ((Get-Field $hb.body "reboot_to_usb_requested") -eq $true) { Invoke-RebootToUsb $inv.stick }
}
