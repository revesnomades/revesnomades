$ErrorActionPreference = "Stop"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$files = Get-ChildItem "c:\Users\mlautery\.antigravity\revesnomades\*.html"
foreach ($f in $files) {
    $bytes = [System.IO.File]::ReadAllBytes($f.FullName)
    $c = [System.Text.Encoding]::UTF8.GetString($bytes)
    
    # Fix any corrupted UTF8 like lÃ©gales -> légales
    $c = $c.Replace("lÃ©gales", "légales").Replace("confidentialitÃ©", "confidentialité").Replace("Â·", "·").Replace("Ã©", "é")
    
    # Remove standalone FAQ link
    $c = [System.Text.RegularExpressions.Regex]::Replace($c, '\s*<a[^>]*faq\.html[^>]*>[^<]*</a>\s*(?:·|\u00B7)?\s*', ' ')
    
    # Replace mentions link
    $c = [System.Text.RegularExpressions.Regex]::Replace($c, '<a[^>]*mentions-legales\.html[^>]*>[^<]*</a>', '<a href="/faq.html">FAQ</a> · <a href="/mentions-legales.html">Mentions légales</a>')
    
    # Replace politique link
    $c = [System.Text.RegularExpressions.Regex]::Replace($c, '<a[^>]*politique-confidentialite\.html[^>]*>[^<]*</a>', '<a href="/politique-confidentialite.html">Politique de confidentialité</a>')
    
    $outBytes = $utf8NoBom.GetBytes($c)
    [System.IO.File]::WriteAllBytes($f.FullName, $outBytes)
    Write-Host "Updated $($f.Name)"
}
Write-Host "All footers updated cleanly with UTF8 No BOM!"
