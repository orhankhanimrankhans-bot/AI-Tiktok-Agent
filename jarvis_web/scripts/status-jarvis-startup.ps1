[CmdletBinding()]
param([string]$TaskName = "Jarvis Always-On Backend")
$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if (-not $task) { Write-Output "NOT INSTALLED"; exit 1 }
$info = Get-ScheduledTaskInfo -TaskName $TaskName
[pscustomobject]@{ TaskName = $TaskName; State = $task.State; LastRunTime = $info.LastRunTime; LastTaskResult = $info.LastTaskResult; NextRunTime = $info.NextRunTime }
