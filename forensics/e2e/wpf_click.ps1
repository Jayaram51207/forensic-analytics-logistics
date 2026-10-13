# Starts one of the built WPF programs and presses a button by its visible label,
# using Windows UI Automation. The real window, the real click handler.
#   powershell -File wpf_click.ps1 -Exe <path> -Button "Copy HTML Table for Email" -Outbox <dir>
# The button used copies to the clipboard; the previous clipboard text is put back afterwards.
param([Parameter(Mandatory)][string]$Exe, [Parameter(Mandatory)][string]$Button, [Parameter(Mandatory)][string]$Outbox)
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$env:FORENSIC_OUTBOX_DIR = $Outbox
$saved = $null
try { $saved = Get-Clipboard -Raw -ErrorAction Stop } catch {}
$p = Start-Process -FilePath $Exe -PassThru
try {
    $root = $null
    for ($i = 0; $i -lt 80 -and -not $root; $i++) {
        Start-Sleep -Milliseconds 500
        $p.Refresh()
        if ($p.HasExited) { throw "program exited with code $($p.ExitCode)" }
        if ($p.MainWindowHandle -ne 0) { $root = [System.Windows.Automation.AutomationElement]::FromHandle($p.MainWindowHandle) }
    }
    if (-not $root) { throw 'main window did not appear' }
    $cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $Button)
    $btn = $null
    for ($i = 0; $i -lt 40 -and -not $btn; $i++) {   # the window handle exists before its content does
        Start-Sleep -Milliseconds 500
        $p.Refresh()   # the first handle can belong to a transient window; always search the current one
        if ($p.MainWindowHandle -ne 0) { $root = [System.Windows.Automation.AutomationElement]::FromHandle($p.MainWindowHandle) }
        $btn = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond)
    }
    if (-not $btn) { throw "button '$Button' not found" }
    $btn.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
    Start-Sleep -Seconds 3   # the handler writes evidence, then shows a confirmation box
    Write-Output 'clicked'
}
finally {
    if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force }
    if ($null -ne $saved) { try { Set-Clipboard -Value $saved } catch {} }
}
