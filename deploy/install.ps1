#Requires -Version 5.1
<#
.SYNOPSIS
  Rezepte-App: Firewall- und Netzwerk-Einrichtung (Teil aus Meilenstein M0).

.DESCRIPTION
  Dieser Stand enthält nur den Firewall- und Netzwerkteil (Kap. 10.3, 10.5, NF-23, NF-24):
    1. Administratorrechte prüfen
    2. Port gegen die von Windows reservierten Portbereiche prüfen (Hyper-V, WSL2, Docker)
    3. Firewall-Regel "RezepteApp" anlegen oder aktualisieren (eingehend, TCP, nur Profil Privat)
    4. Block-Regeln für node.exe finden und nach Rückfrage deaktivieren
    5. Netzwerkprofile prüfen (Warnung bei "Öffentlich")
    6. mDNS prüfen (Richtlinie EnableMDNS, Firewall-Regel UDP 5353)
    7. LAN-Adressen als http://<IP>:<Port> ausgeben

  Der Windows-Dienst (WinSW), Ordner und Rechte unter DataDir, die Node-Pfad- und OneDrive-Prüfung
  sowie die Health-Prüfung folgen in Meilenstein M6.

  Das Skript ist idempotent und kann beliebig oft ausgeführt werden.

.PARAMETER Port
  TCP-Port der App (Standard 8080).

.PARAMETER DataDir
  Datenordner der App (Standard C:\RezepteApp\data). Wird erst ab M6 eingerichtet.

.PARAMETER Force
  Keine Rückfragen: gefundene Block-Regeln für node.exe werden ohne Nachfrage deaktiviert.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File deploy\install.ps1 -Port 8080

.NOTES
  In einer PowerShell "Als Administrator ausführen" starten. Kompatibel mit Windows PowerShell 5.1.
  Exit-Codes: 0 = in Ordnung (Warnungen möglich), 1 = Fehler.
#>
[CmdletBinding()]
param(
  [ValidateRange(1, 65535)]
  [int]$Port = 8080,
  [string]$DataDir = 'C:\RezepteApp\data',
  [switch]$Force
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$RuleName = 'RezepteApp'
# Same exclusions as the server's address list (F-39): virtual and VPN adapters are not reachable from phones.
$VirtualAdapterPattern = 'vEthernet|WSL|Hyper-V|VirtualBox|VMware|VPN|TAP-Windows|WireGuard|Tailscale|ZeroTier'
$script:WarningCount = 0

# --- Output -------------------------------------------------------------------------------------

function Write-Step([string]$Text) {
  Write-Host ''
  Write-Host "== $Text" -ForegroundColor Cyan
}

function Write-Ok([string]$Text) {
  Write-Host "   OK: $Text" -ForegroundColor Green
}

function Write-Info([string]$Text) {
  Write-Host "   $Text"
}

function Write-Warn([string]$Text) {
  $script:WarningCount++
  Write-Host "   WARNUNG: $Text" -ForegroundColor Yellow
}

function Write-Fail([string]$Text) {
  Write-Host ''
  Write-Host "FEHLER: $Text" -ForegroundColor Red
}

# --- Checks (read only) -------------------------------------------------------------------------

function Test-IsAdmin {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# Returns the reserved range containing the port as "start-end", or $null. Throws if netsh fails.
function Get-ReservedPortRange([int]$PortNumber) {
  # The header lines are localized; only the lines starting with two numbers matter.
  # Administered exclusions (trailing "*", added via "netsh add excludedportrange") do not stop
  # a process from binding the port, so they are skipped.
  $lines = @(& netsh int ipv4 show excludedportrange protocol=tcp)
  if ($LASTEXITCODE -ne 0) {
    throw "netsh meldet Exit-Code $LASTEXITCODE"
  }
  foreach ($line in $lines) {
    if ([string]$line -match '^\s*(\d+)\s+(\d+)\s*(\*)?\s*$') {
      if ($Matches[3]) { continue }
      $start = [int]$Matches[1]
      $end = [int]$Matches[2]
      if ($PortNumber -ge $start -and $PortNumber -le $end) {
        return "$start-$end"
      }
    }
  }
  return $null
}

function Test-AffectsPrivateProfile($Rule) {
  $profileText = [string]$Rule.Profile
  return ($profileText -eq 'Any') -or ($profileText -match 'Private')
}

# Block rules win over allow rules. They typically come from a Windows Firewall dialog for node.exe
# that was cancelled or answered for "public" during an earlier "pnpm dev".
function Get-NodeBlockRules {
  $found = @()
  $filters = @(Get-NetFirewallApplicationFilter -Program '*node.exe' -ErrorAction SilentlyContinue)
  foreach ($filter in $filters) {
    $rules = @($filter | Get-NetFirewallRule -ErrorAction SilentlyContinue | Where-Object Action -eq Block)
    foreach ($rule in $rules) {
      # Only rules that actually apply: enabled, inbound and valid for the Private profile the app uses.
      if ($rule.Enabled -eq 'True' -and $rule.Direction -eq 'Inbound' -and (Test-AffectsPrivateProfile $rule)) {
        $found += [pscustomobject]@{ Rule = $rule; Program = $filter.Program }
      }
    }
  }
  return , $found
}

function Test-MdnsDisabledByPolicy {
  $key = 'HKLM:\SOFTWARE\Policies\Microsoft\Windows NT\DNSClient'
  $item = Get-ItemProperty -Path $key -Name 'EnableMDNS' -ErrorAction SilentlyContinue
  if ($null -eq $item) {
    return $false
  }
  return ([int]$item.EnableMDNS -eq 0)
}

# Looks for any enabled inbound allow rule for UDP 5353 in the Private profile. Matching by port instead
# of by name, because the built-in rule "mDNS (UDP-In)" has a localized display name.
function Test-MdnsFirewallOpen {
  # Filtered in PowerShell: "Get-NetFirewallPortFilter -Protocol UDP" returns nothing on Windows 11.
  $filters = @(Get-NetFirewallPortFilter -ErrorAction SilentlyContinue |
      Where-Object { [string]$_.Protocol -eq 'UDP' -and @($_.LocalPort) -contains '5353' })
  foreach ($filter in $filters) {
    $rules = @($filter | Get-NetFirewallRule -ErrorAction SilentlyContinue)
    foreach ($rule in $rules) {
      if ($rule.Enabled -eq 'True' -and $rule.Direction -eq 'Inbound' -and $rule.Action -eq 'Allow' -and
        (Test-AffectsPrivateProfile $rule)) {
        return $true
      }
    }
  }
  return $false
}

function Test-PrivateIPv4([string]$Address) {
  $parts = $Address.Split('.')
  if ($parts.Count -ne 4) {
    return $false
  }
  $a = [int]$parts[0]
  $b = [int]$parts[1]
  if ($a -eq 10) { return $true }
  if ($a -eq 172 -and $b -ge 16 -and $b -le 31) { return $true }
  if ($a -eq 192 -and $b -eq 168) { return $true }
  return $false
}

# Private IPv4 addresses (10/8, 172.16/12, 192.168/16) of connected, non-virtual adapters (F-39).
# 127.x and 169.254.x fall out through the private-range filter.
function Get-LanIPv4Addresses {
  $result = @()
  $adapters = @(Get-NetAdapter -ErrorAction SilentlyContinue | Where-Object Status -eq 'Up')
  $addresses = @(Get-NetIPAddress -AddressFamily IPv4 -AddressState Preferred -ErrorAction SilentlyContinue)
  foreach ($address in $addresses) {
    $adapter = $adapters | Where-Object ifIndex -eq $address.InterfaceIndex | Select-Object -First 1
    if ($null -eq $adapter) { continue }
    if ($adapter.Name -match $VirtualAdapterPattern -or $adapter.InterfaceDescription -match $VirtualAdapterPattern) {
      continue
    }
    if (Test-PrivateIPv4 $address.IPAddress) {
      $result += $address.IPAddress
    }
  }
  return , @($result | Sort-Object -Unique)
}

# --- Changes ------------------------------------------------------------------------------------

function Set-AppFirewallRule([int]$PortNumber) {
  $description = "Rezepte-App im Heimnetz: eingehend TCP $PortNumber, nur Profil Privat (deploy\install.ps1)"
  $existing = @(Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue)
  if ($existing.Count -gt 1) {
    # Duplicates would leave stale ports open; start over with exactly one rule.
    $existing | Remove-NetFirewallRule
    $existing = @()
  }
  if ($existing.Count -eq 0) {
    New-NetFirewallRule -DisplayName $RuleName -Description $description -Direction Inbound -Protocol TCP `
      -LocalPort $PortNumber -Profile Private -Action Allow -Enabled True | Out-Null
    return 'angelegt'
  }
  # -Program Any: a hand-made rule bound to another node.exe path would not match the service later.
  $existing[0] | Set-NetFirewallRule -Description $description -Direction Inbound -Protocol TCP `
    -LocalPort $PortNumber -Profile Private -Action Allow -Enabled True -Program Any
  return 'aktualisiert'
}

function Confirm-Action([string]$Question) {
  if ($Force) {
    return $true
  }
  try {
    $answer = Read-Host "   $Question (j/n)"
  } catch {
    # Non-interactive session: never change anything without an explicit answer.
    Write-Info 'Keine Eingabe möglich (nicht interaktiv). Mit -Force ohne Rückfrage ausführen.'
    return $false
  }
  return ([string]$answer).Trim() -match '^(j|ja|y|yes)$'
}

# --- Main ---------------------------------------------------------------------------------------

try {
  Write-Host 'Rezepte-App: Firewall- und Netzwerk-Einrichtung (M0)' -ForegroundColor Cyan
  Write-Host 'Der Teil für den Windows-Dienst (WinSW), Ordnerrechte und Health-Prüfung folgt in M6.'

  # 1) Administrator rights
  Write-Step '1/7 Administratorrechte'
  if (-not (Test-IsAdmin)) {
    Write-Fail 'Dieses Skript braucht Administratorrechte.'
    Write-Host 'PowerShell mit Rechtsklick > "Als Administrator ausführen" öffnen und das Skript erneut starten:'
    Write-Host "  powershell -ExecutionPolicy Bypass -File deploy\install.ps1 -Port $Port"
    exit 1
  }
  Write-Ok 'Läuft als Administrator.'

  # 2) Reserved port ranges (NF-24)
  Write-Step "2/7 Port $Port"
  $reserved = $null
  try {
    $reserved = Get-ReservedPortRange $Port
  } catch {
    Write-Warn "Reservierte Portbereiche konnten nicht gelesen werden ($($_.Exception.Message))."
  }
  if ($null -ne $reserved) {
    Write-Fail "Port $Port ist von Windows reserviert – anderen Port wählen"
    Write-Host "Reservierter Bereich: $reserved (typisch für Hyper-V, WSL2 oder Docker)."
    Write-Host 'Übersicht: netsh int ipv4 show excludedportrange protocol=tcp'
    Write-Host 'Beispiel: powershell -ExecutionPolicy Bypass -File deploy\install.ps1 -Port 8090'
    exit 1
  }
  Write-Ok "Port $Port liegt in keinem von Windows reservierten Bereich."

  # 3) Firewall rule (NF-23)
  Write-Step "3/7 Firewall-Regel '$RuleName'"
  $ruleResult = Set-AppFirewallRule $Port
  Write-Ok "Regel $($ruleResult): eingehend, TCP $Port, nur Profil Privat, zulassen."

  # 4) Block rules for node.exe
  Write-Step '4/7 Block-Regeln für node.exe'
  $blocked = Get-NodeBlockRules
  if ($blocked.Count -eq 0) {
    Write-Ok 'Keine aktive Block-Regel für node.exe im Profil Privat.'
  } else {
    Write-Warn "$($blocked.Count) aktive Block-Regel(n) für node.exe gefunden. Block-Regeln haben Vorrang vor der Regel '$RuleName':"
    foreach ($entry in $blocked) {
      Write-Info "- $($entry.Rule.DisplayName) [Profil: $($entry.Rule.Profile)] $($entry.Program)"
    }
    if (Confirm-Action 'Diese Regeln jetzt deaktivieren?') {
      foreach ($entry in $blocked) {
        try {
          $entry.Rule | Disable-NetFirewallRule
          Write-Ok "Deaktiviert: $($entry.Rule.DisplayName)"
        } catch {
          # Rules from a group policy cannot be changed locally.
          Write-Warn "Konnte '$($entry.Rule.DisplayName)' nicht deaktivieren: $($_.Exception.Message)"
        }
      }
    } else {
      Write-Warn 'Block-Regeln bleiben aktiv; Handys und Tablets erreichen die App dann nicht.'
      Write-Info 'Später erneut ausführen oder die Regeln in "Windows Defender Firewall mit erweiterter Sicherheit" deaktivieren.'
    }
  }

  # 5) Network profiles
  Write-Step '5/7 Netzwerkprofil'
  $profiles = @(Get-NetConnectionProfile -ErrorAction SilentlyContinue)
  if ($profiles.Count -eq 0) {
    Write-Warn 'Keine aktive Netzwerkverbindung gefunden.'
  }
  foreach ($connection in $profiles) {
    $category = [string]$connection.NetworkCategory
    $label = "'$($connection.Name)' ($($connection.InterfaceAlias))"
    if ($category -eq 'Public') {
      Write-Warn "Netzwerk $label ist als 'Öffentlich' eingestuft. Die Firewall-Regel gilt nur für 'Privat'."
      Write-Info 'Nur im eigenen Heimnetz umstellen (als Administrator):'
      Write-Host "     Set-NetConnectionProfile -InterfaceIndex $($connection.InterfaceIndex) -NetworkCategory Private" -ForegroundColor White
      Write-Info 'Alternativ: Einstellungen > Netzwerk und Internet > Eigenschaften > Netzwerkprofiltyp "Privat".'
    } elseif ($category -eq 'DomainAuthenticated') {
      Write-Warn "Netzwerk $label ist ein Domänennetz; die Firewall-Regel gilt nur für 'Privat'."
    } else {
      Write-Ok "Netzwerk $label ist 'Privat'."
    }
  }

  # 6) mDNS (<Computername>.local, NF-23)
  Write-Step '6/7 mDNS (Adresse <Computername>.local)'
  $mdnsOk = $true
  if (Test-MdnsDisabledByPolicy) {
    $mdnsOk = $false
    Write-Warn 'mDNS ist per Richtlinie abgeschaltet (EnableMDNS = 0). Die .local-Adresse funktioniert nicht; IP-Adresse oder QR-Code verwenden.'
  }
  if (-not (Test-MdnsFirewallOpen)) {
    $mdnsOk = $false
    Write-Warn 'Keine aktive eingehende Firewall-Regel für mDNS (UDP 5353) im Profil Privat. Die .local-Adresse funktioniert dann nicht.'
    Write-Info 'Die Windows-Regel "mDNS (UDP-In)" in "Windows Defender Firewall mit erweiterter Sicherheit" für Privat aktivieren.'
  }
  if ($mdnsOk) {
    Write-Ok 'mDNS ist aktiv. Die .local-Adresse ist eine Komfortadresse; verbindlich ist die IP-Adresse.'
  }

  # 7) Addresses for phones and tablets
  Write-Step '7/7 Adressen im Heimnetz'
  $ips = Get-LanIPv4Addresses
  if ($ips.Count -eq 0) {
    Write-Warn 'Keine private IPv4-Adresse gefunden (LAN-Kabel oder WLAN verbunden?).'
  } else {
    foreach ($ip in $ips) {
      Write-Host "   http://$($ip):$Port" -ForegroundColor White
    }
  }
  # Same name as the server banner (os.hostname() is the DNS host name); COMPUTERNAME is the
  # NetBIOS name and is cut to 15 characters.
  $dnsName = [System.Net.Dns]::GetHostName().ToLowerInvariant()
  Write-Info "Komfortadresse (abhängig von Router und Handy): http://$dnsName.local:$Port"
  Write-Info 'Tipp: Eine DHCP-Reservierung im Router hält die IP-Adresse dauerhaft gleich.'
  $connectDoc = Join-Path (Split-Path -Parent $PSScriptRoot) 'docs\VERBINDEN.md'
  if (Test-Path -LiteralPath $connectDoc) {
    Write-Info "Anleitung für Handy und Tablet: $connectDoc"
  } else {
    Write-Info 'Anleitung für Handy und Tablet: docs\VERBINDEN.md (entsteht in M6).'
  }

  Write-Host ''
  if ($script:WarningCount -gt 0) {
    Write-Host "Fertig mit $($script:WarningCount) Warnung(en), siehe oben." -ForegroundColor Yellow
  } else {
    Write-Host 'Fertig.' -ForegroundColor Green
  }
  Write-Host "Noch nicht enthalten (folgt in M6): Windows-Dienst 'RezepteApp' (WinSW), Datenordner $DataDir mit Rechten, Health-Prüfung."
  Write-Host 'Bis dahin den Server im Repository mit "pnpm build" und "pnpm start" starten.'
  exit 0
} catch {
  Write-Fail "Unerwarteter Fehler: $($_.Exception.Message)"
  exit 1
}
