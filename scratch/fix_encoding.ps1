$ErrorActionPreference = "Stop"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$files = Get-ChildItem "c:\Users\mlautery\.antigravity\revesnomades\*.html"

$badE = [string][char]0x00C3 + [string][char]0x00A9  # Ã©
$goodE = [string][char]0x00E9                        # é
$badDot = [string][char]0x00C2 + [string][char]0x00B7 # Â·
$goodDot = [string][char]0x00B7                      # ·

foreach ($f in $files) {
    $bytes = [System.IO.File]::ReadAllBytes($f.FullName)
    $c = [System.Text.Encoding]::UTF8.GetString($bytes)
    
    $c = $c.Replace($badE, $goodE).Replace($badDot, $goodDot)
    
    $outBytes = $utf8NoBom.GetBytes($c)
    [System.IO.File]::WriteAllBytes($f.FullName, $outBytes)
}
Write-Host "Fixed encoding cleanly!"
