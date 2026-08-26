[CmdletBinding()]
param([string]$TaskName = "Jarvis Always-On Backend")
$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$serverDirectory = Join-Path $projectRoot "server"
$serverEntry = Join-Path $serverDirectory "index.js"
$node = (Get-Command node.exe -ErrorAction Stop).Source
if (-not (Test-Path -LiteralPath $serverEntry)) { throw "Jarvis server entry point was not found." }
$action = New-ScheduledTaskAction -Execute $node -Argument ('"{0}"' -f $serverEntry) -WorkingDirectory $serverDirectory
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId ("{0}\{1}" -f $env:USERDOMAIN, $env:USERNAME) -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description "Starts the Jarvis Node.js backend without Chrome or VS Code." -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName
Write-Output "Jarvis startup task installed and started: $TaskName"
