[CmdletBinding()]
param([string]$TaskName = "Jarvis Always-On Backend")
$ErrorActionPreference = "Stop"
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) { Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false; Write-Output "Corex startup task removed: $TaskName" } else { Write-Output "Corex startup task is not installed." }
